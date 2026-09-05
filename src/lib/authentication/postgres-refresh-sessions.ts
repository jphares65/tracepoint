import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const issuerPattern=/^https:\/\/cognito-idp\.us-east-1\.amazonaws\.com\/us-east-1_[A-Za-z0-9]+$/;
const hash=(handle:string)=>{if(!/^[A-Za-z0-9_-]{43}$/.test(handle))throw Error('Invalid refresh handle.');return createHash('sha256').update(handle).digest('hex');};
export type RefreshIdentity={userId:string;issuer:string;subject:string;clientId:string;authenticatedAt:number;expiresAt:number};
export type ConsumedRefresh=RefreshIdentity & {familyId:string;generation:number;refreshToken:string};
type Row={family_id:string;issuer:string;subject:string;tracepoint_user_id:string;client_id:string;handle_hash:string;generation:number;state:string;sealed_payload:string|null;authenticated_at:Date;expires_at:Date};
function valid(identity:RefreshIdentity){const now=Math.floor(Date.now()/1000);return uuid.test(identity.userId)&&uuid.test(identity.subject)&&issuerPattern.test(identity.issuer)&&/^[A-Za-z0-9]{1,128}$/.test(identity.clientId)&&Number.isInteger(identity.authenticatedAt)&&Number.isInteger(identity.expiresAt)&&identity.authenticatedAt<=now+30&&identity.expiresAt>now&&identity.expiresAt>identity.authenticatedAt&&identity.expiresAt-identity.authenticatedAt<=86400;}
const tokenValid=(token:string)=>typeof token==='string'&&token.length>0&&token.length<=16384&&!/[\s\x00-\x1f]/.test(token);
function identity(row:Row):RefreshIdentity{return {userId:row.tracepoint_user_id,issuer:row.issuer,subject:row.subject,clientId:row.client_id,authenticatedAt:Math.floor(new Date(row.authenticated_at).getTime()/1000),expiresAt:Math.floor(new Date(row.expires_at).getTime()/1000)};}
function binding(row:Row){return JSON.stringify([row.family_id,row.generation,row.handle_hash,identity(row)]);}

// Separate purpose/AAD from PKCE state. Keys are provided in server memory only.
export class RefreshSessionSealer {
 private readonly keys:Map<string,Buffer>;
 constructor(private readonly activeKey:string,keys:ReadonlyMap<string,Uint8Array>){
  if(!/^[A-Za-z0-9_-]{1,32}$/.test(activeKey)||!keys.has(activeKey)||keys.size<1||keys.size>3)throw Error('Invalid refresh encryption configuration.');
  this.keys=new Map([...keys].map(([id,key])=>{if(!/^[A-Za-z0-9_-]{1,32}$/.test(id)||key.byteLength!==32)throw Error('Invalid refresh encryption configuration.');return [id,Buffer.from(key)];}));
 }
 seal(token:string,aad:string){
  if(!tokenValid(token))throw Error('Invalid refresh token.');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.keys.get(this.activeKey)!,iv);cipher.setAAD(Buffer.from('tracepoint-cognito-refresh-v1:'+aad));
  const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return ['v1',this.activeKey,iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
 }
 open(value:string,aad:string){try{
  if(value.length>32768)throw Error();const [v,id,ivText,tagText,text,...extra]=value.split('.');if(v!=='v1'||extra.length||!this.keys.has(id)||![ivText,tagText,text].every(x=>/^[A-Za-z0-9_-]+$/.test(x)))throw Error();
  const iv=Buffer.from(ivText,'base64url'),tag=Buffer.from(tagText,'base64url');if(iv.length!==12||tag.length!==16)throw Error();
  const decipher=createDecipheriv('aes-256-gcm',this.keys.get(id)!,iv);decipher.setAAD(Buffer.from('tracepoint-cognito-refresh-v1:'+aad));decipher.setAuthTag(tag);
  const token=Buffer.concat([decipher.update(Buffer.from(text,'base64url')),decipher.final()]).toString('utf8');if(!tokenValid(token))throw Error();return token;
 }catch{throw Error('Refresh state could not be decrypted.');}}
}

// Disabled trusted-server store. Create only after signed initial authentication;
// authenticatedAt is the original verified auth_time, never the refresh iat.
// consume commits BEFORE any provider call. Failed/ambiguous exchanges remain
// consumed and cannot retry, even within Cognito's token-rotation grace period.
export class PostgresCognitoRefreshStore {
 constructor(private readonly pool:Pick<Pool,'connect'|'query'>,private readonly sealer:RefreshSessionSealer,private readonly target:{issuer:string;clientId:string}){
  if(!issuerPattern.test(target?.issuer)||!/^[A-Za-z0-9]{1,128}$/.test(target?.clientId))throw Error('Explicit refresh provider boundary required.');
 }
 private matchesTarget(value:RefreshIdentity){return value.issuer===this.target.issuer&&value.clientId===this.target.clientId;}
 private async connect(){try{return await this.pool.connect();}catch{throw Error('Refresh persistence unavailable.');}}
 private async activeMapping(client:PoolClient,value:RefreshIdentity){
  const mapping=await client.query("select 1 from public.authentication_identity_links where provider='cognito' and issuer=$1 and subject=$2 and tracepoint_user_id=$3 and state='active' for update",[value.issuer,value.subject,value.userId]);
  if(mapping.rowCount!==1)throw Error();
  const revoked=await client.query('select 1 from public.authentication_session_revocations where tracepoint_user_id=$1 and issuer=$2 and revoked_before>=to_timestamp($3)',[value.userId,value.issuer,value.authenticatedAt]);if(revoked.rowCount)throw Error();
 }
 async createVerified(value:RefreshIdentity,refreshToken:string){
  if(!valid(value)||!this.matchesTarget(value)||!tokenValid(refreshToken))throw Error('Invalid verified refresh identity.');
  const handle=randomBytes(32).toString('base64url'),row:Row={family_id:randomUUID(),issuer:value.issuer,subject:value.subject,tracepoint_user_id:value.userId,client_id:value.clientId,handle_hash:hash(handle),generation:0,state:'ready',sealed_payload:null,authenticated_at:new Date(value.authenticatedAt*1000),expires_at:new Date(value.expiresAt*1000)};
  const client=await this.connect();try{await client.query('begin');await this.activeMapping(client,value);
   await client.query(`insert into public.authentication_refresh_sessions(family_id,issuer,subject,tracepoint_user_id,client_id,handle_hash,sealed_payload,authenticated_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),to_timestamp($9))`,[row.family_id,value.issuer,value.subject,value.userId,value.clientId,row.handle_hash,this.sealer.seal(refreshToken,binding(row)),value.authenticatedAt,value.expiresAt]);await client.query('commit');
   return {familyId:row.family_id,handle,expiresAt:value.expiresAt};
  }catch{await client.query('rollback').catch(()=>{});throw Error('Refresh session registration rejected.');}finally{client.release();}
 }
 async consume(handle:string):Promise<ConsumedRefresh|null>{
  const handleHash=hash(handle),client=await this.connect();let row:Row|undefined;
  try{await client.query('begin');const result=await client.query<Row>("select * from public.authentication_refresh_sessions where handle_hash=$1 and issuer=$2 and client_id=$3 and state='ready' and expires_at>clock_timestamp() for update",[handleHash,this.target.issuer,this.target.clientId]);row=result.rows[0];
   if(!row){await client.query('commit');return null;}
   // No mapping lock is taken here: completion serializes on that mapping and
   // rechecks the original authentication watermark after the provider call.
   await client.query("update public.authentication_refresh_sessions set state='consumed',sealed_payload=null,updated_at=clock_timestamp() where family_id=$1",[row.family_id]);await client.query('commit');
  }catch{await client.query('rollback').catch(()=>{});throw Error('Refresh session could not be consumed.');}finally{client.release();}
  const value=identity(row);if(!valid(value))return null;
  const allowed=await this.pool.query("select 1 from public.authentication_identity_links l where l.provider='cognito' and l.issuer=$1 and l.subject=$2 and l.tracepoint_user_id=$3 and l.state='active' and not exists(select 1 from public.authentication_session_revocations r where r.tracepoint_user_id=$3 and r.issuer=$1 and r.revoked_before>=to_timestamp($4))",[value.issuer,value.subject,value.userId,value.authenticatedAt]).catch(()=>{throw Error('Refresh persistence unavailable.');});
  if(allowed.rowCount!==1)return null;
  return {...value,familyId:row.family_id,generation:row.generation,refreshToken:this.sealer.open(row.sealed_payload!,binding(row))};
 }
 async completeVerified(consumed:ConsumedRefresh,rotatedRefreshToken:string){
  if(!valid(consumed)||!this.matchesTarget(consumed)||!uuid.test(consumed.familyId)||!Number.isInteger(consumed.generation)||consumed.generation<0||!tokenValid(rotatedRefreshToken)||rotatedRefreshToken===consumed.refreshToken)throw Error('Invalid verified refresh rotation.');
  const client=await this.connect();try{await client.query('begin');await this.activeMapping(client,consumed);
   const result=await client.query<Row>("select * from public.authentication_refresh_sessions where family_id=$1 and state='consumed' and generation=$2 and expires_at>clock_timestamp() for update",[consumed.familyId,consumed.generation]);const row=result.rows[0];
   if(!row||JSON.stringify(identity(row))!==JSON.stringify({userId:consumed.userId,issuer:consumed.issuer,subject:consumed.subject,clientId:consumed.clientId,authenticatedAt:consumed.authenticatedAt,expiresAt:consumed.expiresAt}))throw Error();
   const handle=randomBytes(32).toString('base64url');row.handle_hash=hash(handle);row.generation++;
   await client.query("update public.authentication_refresh_sessions set handle_hash=$2,generation=$3,state='ready',sealed_payload=$4,updated_at=clock_timestamp() where family_id=$1",[row.family_id,row.handle_hash,row.generation,this.sealer.seal(rotatedRefreshToken,binding(row))]);await client.query('commit');return {familyId:row.family_id,handle,expiresAt:consumed.expiresAt};
  }catch{await client.query('rollback').catch(()=>{});throw Error('Refresh rotation could not be committed. Start a new sign-in.');}finally{client.release();}
 }
 async revokeFamily(familyId:string,owner:{userId:string;issuer:string}){
  if(!uuid.test(familyId)||!uuid.test(owner.userId)||owner.issuer!==this.target.issuer)throw Error('Invalid refresh revocation boundary.');
  await this.pool.query("update public.authentication_refresh_sessions set state='revoked',sealed_payload=null,updated_at=clock_timestamp() where family_id=$1 and tracepoint_user_id=$2 and issuer=$3 and client_id=$4",[familyId,owner.userId,owner.issuer,this.target.clientId]).catch(()=>{throw Error('Refresh revocation could not be persisted.');});
 }
 async purgeExpired(){try{const result=await this.pool.query('delete from public.authentication_refresh_sessions where issuer=$1 and client_id=$2 and expires_at<=clock_timestamp()',[this.target.issuer,this.target.clientId]);return result.rowCount??0;}catch{throw Error('Refresh expiry cleanup failed.');}}
}

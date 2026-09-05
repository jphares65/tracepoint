import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import type {AuthorizationTransaction,AuthorizationTransactionStore} from './cognito-pkce';
const hash=(handle:string)=>{if(!/^[A-Za-z0-9_-]{43}$/.test(handle))throw Error('Invalid flow handle.');return createHash('sha256').update(handle).digest('hex');};
export class AuthenticationStateSealer {
 private readonly keys:Map<string,Buffer>;
 constructor(private readonly activeKey:string,keys:ReadonlyMap<string,Uint8Array>){
  if(!/^[A-Za-z0-9_-]{1,32}$/.test(activeKey)||!keys.has(activeKey)||keys.size>3||keys.size<1)throw Error('Invalid authentication encryption configuration.');
  this.keys=new Map([...keys].map(([id,key])=>{if(!/^[A-Za-z0-9_-]{1,32}$/.test(id)||key.byteLength!==32)throw Error('Invalid authentication encryption configuration.');return [id,Buffer.from(key)];}));
 }
 seal(value:AuthorizationTransaction,binding:string){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.keys.get(this.activeKey)!,iv);cipher.setAAD(Buffer.from('tracepoint-cognito-flow-v1:'+binding));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return ['v1',this.activeKey,iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
 }
 open(sealed:string,binding:string):AuthorizationTransaction{
  try{
   if(sealed.length>8192)throw Error();const [version,id,ivText,tagText,text,...extra]=sealed.split('.');if(version!=='v1'||extra.length||!this.keys.has(id)||![ivText,tagText,text].every(x=>/^[A-Za-z0-9_-]+$/.test(x)))throw Error();
   const iv=Buffer.from(ivText,'base64url'),tag=Buffer.from(tagText,'base64url');if(iv.length!==12||tag.length!==16)throw Error();
   const decipher=createDecipheriv('aes-256-gcm',this.keys.get(id)!,iv);decipher.setAAD(Buffer.from('tracepoint-cognito-flow-v1:'+binding));decipher.setAuthTag(tag);
   return JSON.parse(Buffer.concat([decipher.update(Buffer.from(text,'base64url')),decipher.final()]).toString('utf8'));
  }catch{throw Error('Authentication state could not be decrypted.');}
 }
}
export class PostgresAuthorizationTransactionStore implements AuthorizationTransactionStore {
 constructor(private readonly pool:Pick<Pool,'query'>,private readonly sealer:AuthenticationStateSealer){}
 async put(handle:string,transaction:AuthorizationTransaction){
  try{const binding=hash(handle);await this.pool.query('insert into public.authentication_flow_transactions(handle_hash,sealed_payload,expires_at) values($1,$2,$3)',[binding,this.sealer.seal(transaction,binding),new Date(transaction.expiresAt)]);}catch{throw Error('Authentication transaction could not be stored.');}
 }
 async take(handle:string):Promise<AuthorizationTransaction|null>{
  try{const binding=hash(handle);const result=await this.pool.query('delete from public.authentication_flow_transactions where handle_hash=$1 returning sealed_payload,expires_at',[binding]);
   if(result.rowCount!==1||new Date(result.rows[0].expires_at).getTime()<=Date.now())return null;
   return this.sealer.open(result.rows[0].sealed_payload,binding);
  }catch{throw Error('Authentication transaction could not be consumed.');}
 }
 async purgeExpired(){const result=await this.pool.query('delete from public.authentication_flow_transactions where expires_at<=now()');return result.rowCount??0;}
}

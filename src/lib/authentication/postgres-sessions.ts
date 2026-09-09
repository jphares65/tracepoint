import type {Pool} from 'pg';
import type {SessionActivityCheck} from './cognito-verifier';
type SessionKey=Parameters<SessionActivityCheck>[0];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function valid(input:SessionKey){return uuid.test(input.userId)&&uuid.test(input.subject)&&uuid.test(input.tokenId)&&/^https:\/\/cognito-idp\.us-east-1\.amazonaws\.com\/us-east-1_[A-Za-z0-9]+$/.test(input.issuer)&&Number.isInteger(input.issuedAt);}
// Construct only from the trusted server pool. Registration accepts claims only
// after signature/client/nonce verification; it is not an authentication API.
export class PostgresCognitoSessionStore {
 constructor(private readonly pool:Pick<Pool,'query'|'connect'>){}
 readonly isActive:SessionActivityCheck=async input=>{
  if(!valid(input))return false;
  try{const result=await this.pool.query(`select 1 from public.authentication_access_sessions s
   join public.authentication_identity_links l on l.provider=s.provider and l.issuer=s.issuer and l.subject=s.subject and l.tracepoint_user_id=s.tracepoint_user_id
   left join public.authentication_session_revocations r on r.tracepoint_user_id=s.tracepoint_user_id and r.issuer=s.issuer
   where s.tracepoint_user_id=$1 and s.issuer=$2 and s.subject=$3 and s.token_id=$4 and s.issued_at=to_timestamp($5)
    and l.state='active' and s.revoked_at is null and s.expires_at>clock_timestamp()
    and (r.revoked_before is null or s.issued_at>r.revoked_before)`,[input.userId,input.issuer,input.subject,input.tokenId,input.issuedAt]);return result.rowCount===1;}catch{return false;}
 };
 async registerVerified(input:SessionKey & {expiresAt:number}){
  const now=Math.floor(Date.now()/1000);if(!valid(input)||!Number.isInteger(input.expiresAt)||input.expiresAt<=now||input.issuedAt>now+30||input.expiresAt<=input.issuedAt||input.expiresAt-input.issuedAt>900)throw Error('Invalid verified session claims.');
  const client=await this.pool.connect();try{await client.query('begin');
   const mapping=await client.query("select 1 from public.authentication_identity_links where provider='cognito' and issuer=$1 and subject=$2 and tracepoint_user_id=$3 and state='active' for update",[input.issuer,input.subject,input.userId]);if(mapping.rowCount!==1)throw Error();
   const result=await client.query(`insert into public.authentication_access_sessions(issuer,subject,tracepoint_user_id,token_id,issued_at,expires_at)
    select $1,$2,$3,$4,to_timestamp($5),to_timestamp($6)
    where not exists(select 1 from public.authentication_session_revocations where tracepoint_user_id=$3 and issuer=$1 and revoked_before>=to_timestamp($5))`,[input.issuer,input.subject,input.userId,input.tokenId,input.issuedAt,input.expiresAt]);if(result.rowCount!==1)throw Error();
   await client.query('commit');
  }catch{await client.query('rollback').catch(()=>{});throw Error('Verified session registration rejected.');}finally{client.release();}
 }
 async revokeToken(input:SessionKey){if(!valid(input))throw Error('Invalid session key.');await this.pool.query('update public.authentication_access_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where tracepoint_user_id=$1 and issuer=$2 and subject=$3 and token_id=$4',[input.userId,input.issuer,input.subject,input.tokenId]);}
 async revokeAll(input:{userId:string;issuer:string}){
  if(!uuid.test(input.userId)||!/^https:\/\/cognito-idp\.us-east-1\.amazonaws\.com\/us-east-1_[A-Za-z0-9]+$/.test(input.issuer))throw Error('Invalid identity key.');
  const client=await this.pool.connect();try{await client.query('begin');const mapping=await client.query("select 1 from public.authentication_identity_links where provider='cognito' and issuer=$1 and tracepoint_user_id=$2 for update",[input.issuer,input.userId]);if(mapping.rowCount!==1)throw Error();
   await client.query(`insert into public.authentication_session_revocations(tracepoint_user_id,issuer,revoked_before) values($1,$2,clock_timestamp())
    on conflict(tracepoint_user_id,issuer) do update set revoked_before=greatest(authentication_session_revocations.revoked_before,excluded.revoked_before)`,[input.userId,input.issuer]);
   await client.query('update public.authentication_access_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where tracepoint_user_id=$1 and issuer=$2',[input.userId,input.issuer]);await client.query('commit');
  }catch{await client.query('rollback').catch(()=>{});throw Error('Identity session revocation failed.');}finally{client.release();}
 }
 async purgeExpired(){const result=await this.pool.query('delete from public.authentication_access_sessions where expires_at<=now()');return result.rowCount??0;}
}

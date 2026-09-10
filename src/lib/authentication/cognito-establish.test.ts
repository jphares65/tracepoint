import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {generateKeyPairSync,sign,randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import {SimpleJwksCache,type Jwk} from 'aws-jwt-verify/jwk';
import {localPostgresPort} from '../../test-support/local-postgres-port.mjs';
import {createCognitoSessionEstablisher} from './cognito-establish';
import {createCognitoRefreshRotator} from './cognito-refresh';
import {PostgresCognitoRefreshStore,RefreshSessionSealer} from './postgres-refresh-sessions';
import {PostgresCognitoSessionStore} from './postgres-sessions';
const config={environment:'staging' as const,account:'559054714699',region:'us-east-1',userPoolId:'us-east-1_Synthetic',clientId:'syntheticclient'};
const issuer='https://cognito-idp.us-east-1.amazonaws.com/'+config.userPoolId,nonce='N'.repeat(43);
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const cache=new SimpleJwksCache({fetcher:{async fetch(){throw Error('Network disabled');}}});
cache.addJwks(issuer+'/.well-known/jwks.json',{keys:[{...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'} as Jwk]});
let server:EmbeddedPostgres,pool:pg.Pool,directory:string;
before(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'tracepoint-cognito-compose-'));const port=await localPostgresPort();
 server=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password:'synthetic-local-only',port,persistent:true,postgresFlags:['-h','127.0.0.1'],initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
 await server.initialise();await server.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'synthetic-local-only',database:'postgres'});
 await pool.query('create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key)');
 for(const file of ['202609050006_authentication_identity_links.sql','202609050010_authentication_session_state.sql','202609050011_authentication_refresh_state.sql'])await pool.query(await readFile('supabase/migrations/'+file,'utf8'));
 await pool.query(await readFile('database/aws/002_cognito_application_session_idle.sql','utf8'));
});
after(async()=>{
 await pool?.end();await server?.stop();
 if(directory){const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep));assert.ok(path.basename(resolved).startsWith('tracepoint-cognito-compose-'));await rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});await assert.rejects(access(resolved));}
});
async function fixture(){
 const userId=randomUUID(),subject=randomUUID(),authTime=Math.floor(Date.now()/1000)-60;
 await pool.query('insert into profiles values($1)',[userId]);await pool.query("insert into authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state) values('cognito',$1,$2,$3,'active')",[issuer,subject,userId]);
 const mapping={async findActive(i:string,s:string){const result=await pool.query("select tracepoint_user_id from authentication_identity_links where issuer=$1 and subject=$2 and state='active'",[i,s]);return result.rowCount===1?{userId:result.rows[0].tracepoint_user_id}:null;}};
 const sessions=new PostgresCognitoSessionStore(pool),refresh=new PostgresCognitoRefreshStore(pool,new RefreshSessionSealer('synthetic',new Map([['synthetic',randomBytes(32)]])),{issuer,clientId:config.clientId});
 function jwt(kind:'id'|'access',patch:Record<string,unknown>={}){
  const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({kid:'fixture',alg:'RS256'})).toString('base64url');
  const body=Buffer.from(JSON.stringify({iss:issuer,sub:subject,token_use:kind,iat:now,exp:now+300,auth_time:authTime,jti:randomUUID(),...(kind==='id'?{aud:config.clientId,nonce}:{client_id:config.clientId}),...patch})).toString('base64url');
  const unsigned=header+'.'+body;return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');
 }
 const tokens=(idPatch:Record<string,unknown>={},accessPatch:Record<string,unknown>={})=>({idToken:jwt('id',idPatch),accessToken:jwt('access',accessPatch),refreshToken:randomBytes(40).toString('base64url'),expiresIn:300});
 const establish=createCognitoSessionEstablisher(config,mapping,sessions,refresh,{jwksCache:cache});
 return {userId,subject,authTime,mapping,sessions,refresh,tokens,establish};
}
test('signed initial establishment and rotation compose with real durable PostgreSQL state',async()=>{
 const f=await fixture(),initial=f.tokens(),receipt=await f.establish(initial,nonce);assert.equal(receipt.userId,f.userId);assert.equal(receipt.expiresAt,f.authTime+86400);assert.match(receipt.handle,/^[A-Za-z0-9_-]{43}$/);
 const row=(await pool.query('select handle_hash,sealed_payload from authentication_refresh_sessions where tracepoint_user_id=$1',[f.userId])).rows[0];assert.notEqual(row.handle_hash,receipt.handle);assert.equal(row.sealed_payload.includes(initial.refreshToken),false);
 let exchanges=0;const rotate=createCognitoRefreshRotator(config,f.mapping,f.sessions,f.refresh,async token=>{
  exchanges++;assert.equal(token,initial.refreshToken);assert.equal((await pool.query('select state from authentication_refresh_sessions where tracepoint_user_id=$1',[f.userId])).rows[0].state,'consumed');return f.tokens();
 },{jwksCache:cache});
 const rotated=await rotate(receipt.handle);assert.notEqual(rotated.handle,receipt.handle);assert.equal(rotated.expiresAt,receipt.expiresAt);await assert.rejects(rotate(receipt.handle));assert.equal(exchanges,1);
 assert.equal((await pool.query('select count(*)::int as count from authentication_access_sessions where tracepoint_user_id=$1',[f.userId])).rows[0].count,2);
});
test('bad nonce or inconsistent original authentication cannot issue a durable refresh handle',async()=>{
 for(const [idPatch,accessPatch,suppliedNonce] of [[{}, {},'wrong'],[{auth_time:0},{auth_time:0},nonce],[{}, {auth_time:1},nonce]] as [Record<string,unknown>,Record<string,unknown>,string][]){
  const f=await fixture();await assert.rejects(f.establish(f.tokens(idPatch,accessPatch),suppliedNonce),{message:'Cognito session establishment failed. Start a new sign-in.'});assert.equal((await pool.query('select count(*)::int as count from authentication_refresh_sessions where tracepoint_user_id=$1',[f.userId])).rows[0].count,0);
 }
});
test('global logout during token exchange prevents rotation commit in the real store',async()=>{
 const f=await fixture(),receipt=await f.establish(f.tokens(),nonce);
 const rotate=createCognitoRefreshRotator(config,f.mapping,f.sessions,f.refresh,async()=>{await f.sessions.revokeAll({userId:f.userId,issuer});return f.tokens();},{jwksCache:cache});
 await assert.rejects(rotate(receipt.handle));const row=(await pool.query('select state,sealed_payload from authentication_refresh_sessions where tracepoint_user_id=$1',[f.userId])).rows[0];assert.deepEqual(row,{state:'revoked',sealed_payload:null});
});
test('mapping revocation between initial verification and refresh persistence denies the browser receipt',async()=>{
 const f=await fixture();const establish=createCognitoSessionEstablisher(config,f.mapping,f.sessions,{async createVerified(identity,token){await pool.query("update authentication_identity_links set state='revoked' where tracepoint_user_id=$1",[f.userId]);return f.refresh.createVerified(identity,token);}},{jwksCache:cache});
 await assert.rejects(establish(f.tokens(),nonce));assert.equal((await pool.query('select count(*)::int as count from authentication_refresh_sessions where tracepoint_user_id=$1',[f.userId])).rows[0].count,0);
});

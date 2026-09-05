import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { SimpleJwksCache, type Jwk } from 'aws-jwt-verify/jwk';
import { createCognitoAuthenticationProvider, type CognitoVerificationConfig, type SessionActivityCheck } from './cognito-verifier';
import { SupabaseAuthenticationProvider, resolveIdentityDepartment, type IdentityMappingStore } from './provider-core';
const config:CognitoVerificationConfig={environment:'staging',account:'559054714699',region:'us-east-1',userPoolId:'us-east-1_Synthetic',clientId:'syntheticclient'};
const issuer='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic';
const subject='11111111-1111-4111-8111-111111111111',stable='22222222-2222-4222-8222-222222222222';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const cache=new SimpleJwksCache({fetcher:{async fetch(){throw Error('Network forbidden in unit tests')}}});
cache.addJwks(issuer+'/.well-known/jwks.json',{keys:[{...publicKey.export({format:'jwk'}),kid:'synthetic',alg:'RS256',use:'sig'} as Jwk]});
function token(patch:Record<string,unknown>={},headerPatch:Record<string,unknown>={}){
 const now=Math.floor(Date.now()/1000);const header=Buffer.from(JSON.stringify({kid:'synthetic',alg:'RS256',...headerPatch})).toString('base64url');
 const body=Buffer.from(JSON.stringify({iss:issuer,sub:subject,token_use:'access',client_id:config.clientId,iat:now,exp:now+300,jti:'33333333-3333-4333-8333-333333333333',username:'synthetic',scope:'openid',...patch})).toString('base64url');
 const unsigned=header+'.'+body;return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');
}
function provider(mapping:IdentityMappingStore={async findActive(){return {userId:stable}}},active:SessionActivityCheck=async()=>true){return createCognitoAuthenticationProvider(config,mapping,active,{jwksCache:cache});}
test('valid signed access token maps to stable identity and ignores privilege-bearing claims',async()=>{
 const identity=await provider().verifySession(token({'cognito:groups':['administrator'],'custom:department_id':'foreign','custom:user_id':'attacker',email:'attacker@example.invalid'}));
 assert.deepEqual(identity,{userId:stable,provider:'cognito',issuer,subject});
});
test('wrong issuer/client/token type, expiration and excessive lifetime fail closed',async()=>{
 const now=Math.floor(Date.now()/1000);
 for(const patch of [{iss:issuer+'foreign'},{client_id:'other'},{token_use:'id',aud:config.clientId},{exp:now-1},{iat:now+120,exp:now+300},{exp:now+3600},{jti:'invalid'},{sub:'invalid'}])assert.equal(await provider().verifySession(token(patch)),null);
 assert.equal(await provider().verifySession(token({}, {alg:'none'})),null);
 const signed=token();assert.equal(await provider().verifySession(signed.slice(0,-8)+'tampered'),null);
});
test('unmapped, revoked or unavailable identity/session state never authenticates',async()=>{
 assert.equal(await provider({async findActive(){return null}}).verifySession(token()),null);
 assert.equal(await provider({async findActive(){throw Error('private')}}).verifySession(token()),null);
 assert.equal(await provider(undefined,async()=>false).verifySession(token()),null);
 assert.equal(await provider(undefined,async()=>{throw Error('private')}).verifySession(token()),null);
});
test('management account, cross-environment account and wrong region are rejected',()=>{
 for(const patch of [{account:'265544358665'},{account:'111111111111'},{region:'us-west-2'},{environment:'production' as const}])assert.throws(()=>createCognitoAuthenticationProvider({...config,...patch},{async findActive(){return null}},async()=>true),/boundary/);
});
test('Supabase adapter preserves stable UUID and requires verified user response',async()=>{
 assert.equal((await new SupabaseAuthenticationProvider('https://synthetic.supabase.co',async()=>({id:stable})).verifySession())?.userId,stable);
 assert.equal(await new SupabaseAuthenticationProvider('https://synthetic.supabase.co',async()=>null).verifySession(),null);
 assert.equal(await new SupabaseAuthenticationProvider('https://synthetic.supabase.co',async()=>{throw Error('private')}).verifySession(),null);
});
test('department authorization uses stable server mapping and rejects foreign memberships',async()=>{
 const identity=(await provider().verifySession(token({'custom:department_id':'foreign','cognito:groups':['administrator']})))!;
 const lookup=async(userId:string,departmentId:string)=>{assert.equal(userId,stable);return departmentId==='own'?{departmentId:'own',permissions:['view_personnel']}:null};
 assert.deepEqual(await resolveIdentityDepartment(identity,'own',lookup),{departmentId:'own',permissions:['view_personnel']});
 assert.equal(await resolveIdentityDepartment(identity,'foreign',lookup),null);
 assert.equal(await resolveIdentityDepartment(identity,'foreign',async()=>({departmentId:'own',permissions:['administrator']})),null);
});

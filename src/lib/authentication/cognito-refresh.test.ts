import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {SimpleJwksCache,type Jwk} from 'aws-jwt-verify/jwk';
import {createCognitoRefreshRotator} from './cognito-refresh';
const config={environment:'staging' as const,account:'559054714699',region:'us-east-1',userPoolId:'us-east-1_Synthetic',clientId:'syntheticclient'};
const issuer='https://cognito-idp.us-east-1.amazonaws.com/'+config.userPoolId,subject=randomUUID(),userId=randomUUID(),authTime=Math.floor(Date.now()/1000)-60;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const cache=new SimpleJwksCache({fetcher:{async fetch(){throw Error('Network disabled');}}});
cache.addJwks(issuer+'/.well-known/jwks.json',{keys:[{...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'} as Jwk]});
function jwt(kind:'id'|'access',patch:Record<string,unknown>={}){
 const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({kid:'fixture',alg:'RS256'})).toString('base64url');
 const body=Buffer.from(JSON.stringify({iss:issuer,sub:subject,token_use:kind,iat:now,exp:now+300,auth_time:authTime,jti:randomUUID(),...(kind==='id'?{aud:config.clientId}:{client_id:config.clientId}),...patch})).toString('base64url');
 const unsigned=header+'.'+body;return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');
}
const tokens=(idPatch:Record<string,unknown>={},accessPatch:Record<string,unknown>={})=>({idToken:jwt('id',idPatch),accessToken:jwt('access',accessPatch),refreshToken:'synthetic-rotated',expiresIn:300});
function fixture(options:{value?:ReturnType<typeof tokens>;mappedUser?:string;active?:boolean;exchangeFails?:boolean;commitFails?:boolean;revokeFails?:boolean}={}){
 const calls:string[]=[];let available=true;
 const consumed={userId,issuer,subject,clientId:config.clientId,authenticatedAt:authTime,expiresAt:authTime+86400,familyId:randomUUID(),generation:0,refreshToken:'synthetic-original'};
 const rotate=createCognitoRefreshRotator(config,{async findActive(){return {userId:options.mappedUser??userId};}},
  {async registerVerified(){calls.push('register');},async isActive(){return options.active!==false;}},
  {async consume(){calls.push('consume');if(!available)return null;available=false;return consumed;},
   async completeVerified(original){calls.push('commit');assert.equal(original.authenticatedAt,authTime);if(options.commitFails)throw Error('private detail');return {familyId:consumed.familyId,handle:'R'.repeat(43),expiresAt:consumed.expiresAt};},
   async revokeFamily(){calls.push('revoke');if(options.revokeFails)throw Error('private detail');}},
  async()=>{calls.push('exchange');if(options.exchangeFails)throw Error('private detail');return options.value??tokens();},{jwksCache:cache});
 return {rotate,calls,consumed};
}
test('rotation preserves stable identity and absolute expiry without exposing tokens',async()=>{
 const f=fixture({value:tokens({'custom:user_id':randomUUID(),'cognito:groups':['admin']})});
 assert.deepEqual(await f.rotate('H'.repeat(43)),{userId,handle:'R'.repeat(43),expiresAt:authTime+86400});
 assert.deepEqual(f.calls,['consume','exchange','register','commit']);
});
test('wrong subject client auth time or malformed signature cannot register a session',async()=>{
 for(const value of [tokens({sub:randomUUID()}),tokens({aud:'foreign'}),tokens({auth_time:authTime+1}),tokens({}, {auth_time:authTime+1}),tokens({}, {sub:randomUUID()}),tokens({}, {client_id:'foreign'}),{...tokens(),accessToken:'malformed'}, {...tokens(),idToken:'malformed'}]){
  const f=fixture({value});await assert.rejects(f.rotate('H'.repeat(43)),{message:'Cognito refresh failed. Start a new sign-in.'});assert.equal(f.calls.includes('register'),false);assert.equal(f.calls.at(-1),'revoke');
 }
});
test('a changed stable mapping cannot acquire the original refresh family',async()=>{
 const f=fixture({mappedUser:randomUUID()});await assert.rejects(f.rotate('H'.repeat(43)));assert.equal(f.calls.includes('register'),false);
});
test('ambiguous exchange is never retried even when revocation persistence fails',async()=>{
 const f=fixture({exchangeFails:true,revokeFails:true});await assert.rejects(f.rotate('H'.repeat(43)));await assert.rejects(f.rotate('H'.repeat(43)));assert.equal(f.calls.filter(x=>x==='exchange').length,1);assert.equal(f.calls.includes('register'),false);
});
test('inactive access state and concurrent global logout fail closed',async()=>{
 for(const options of [{active:false},{commitFails:true}]){const f=fixture(options);await assert.rejects(f.rotate('H'.repeat(43)));assert.equal(f.calls.at(-1),'revoke');}
});
test('unrotated or malformed response is rejected before signed session registration',async()=>{
 for(const patch of [{refreshToken:'synthetic-original'},{refreshToken:'bad token'},{expiresIn:901},{expiresIn:0}]){const f=fixture({value:{...tokens(),...patch}});await assert.rejects(f.rotate('H'.repeat(43)));assert.equal(f.calls.includes('register'),false);}
});
test('concurrent use of a handle performs at most one exchange',async()=>{
 const f=fixture(),results=await Promise.allSettled([f.rotate('H'.repeat(43)),f.rotate('H'.repeat(43))]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.calls.filter(x=>x==='exchange').length,1);
});

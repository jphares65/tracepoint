import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {SimpleJwksCache,type Jwk} from 'aws-jwt-verify/jwk';
import {createCognitoInitialSessionVerifier,type InitialCognitoSessionStore} from './cognito-initial-session';
const config={environment:'staging' as const,account:'559054714699',region:'us-east-1',userPoolId:'us-east-1_Synthetic',clientId:'syntheticclient'};
const issuer='https://cognito-idp.us-east-1.amazonaws.com/'+config.userPoolId,subject=randomUUID(),userId=randomUUID(),nonce='N'.repeat(43);
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const cache=new SimpleJwksCache({fetcher:{async fetch(){throw Error('Network disabled');}}});
cache.addJwks(issuer+'/.well-known/jwks.json',{keys:[{...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'} as Jwk]});
function jwt(kind:'id'|'access',patch:Record<string,unknown>={}){
 const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({kid:'fixture',alg:'RS256'})).toString('base64url');
 const body=Buffer.from(JSON.stringify({iss:issuer,sub:subject,token_use:kind,iat:now,exp:now+300,jti:randomUUID(),...(kind==='id'?{aud:config.clientId,nonce}:{client_id:config.clientId}),...patch})).toString('base64url');
 const unsigned=header+'.'+body;return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');
}
const tokens=(idPatch:Record<string,unknown>={},accessPatch:Record<string,unknown>={})=>({idToken:jwt('id',idPatch),accessToken:jwt('access',accessPatch),refreshToken:'synthetic-unused',expiresIn:300});
function fixture({mapped=true,active=true,failRegistration=false}={}){
 const registered:Parameters<InitialCognitoSessionStore['registerVerified']>[0][]=[];
 const store:InitialCognitoSessionStore={async registerVerified(input){if(failRegistration)throw Error('private database detail');registered.push(input);},async isActive(input){return active&&registered.some(x=>x.tokenId===input.tokenId&&x.userId===input.userId);}};
 const verify=createCognitoInitialSessionVerifier(config,{async findActive(i,s){return mapped&&i===issuer&&s===subject?{userId}:null;}},store,{jwksCache:cache});
 return {verify,registered};
}
test('initial callback registers only matching signed tokens and uses the stable mapping',async()=>{
 const f=fixture(),value=tokens({}, {'custom:user_id':randomUUID(),'cognito:groups':['administrator']});
 assert.deepEqual(await f.verify(value,nonce),{userId});assert.equal(f.registered.length,1);assert.equal(f.registered[0].userId,userId);assert.equal(f.registered[0].subject,subject);assert.equal(f.registered[0].expiresAt-f.registered[0].issuedAt,300);
});
test('wrong nonce subject client and signature cause no persistence mutation',async()=>{
 for(const value of [tokens({nonce:'wrong'}),tokens({sub:randomUUID()}),tokens({aud:'foreign'}),tokens({}, {client_id:'foreign'}),tokens({}, {sub:randomUUID()}),{...tokens(),accessToken:'malformed'}]){
  const f=fixture();await assert.rejects(f.verify(value,nonce),/new sign-in/);assert.equal(f.registered.length,0);
 }
});
test('missing mapping registration failure and post-registration revocation fail closed',async()=>{
 for(const options of [{mapped:false},{failRegistration:true},{active:false}]){const f=fixture(options);await assert.rejects(f.verify(tokens(),nonce),{message:'Initial Cognito session could not be established. Start a new sign-in.'});assert.equal(f.registered.length,options.active===false?1:0);}
});
test('concurrent callbacks cannot mix verified token claims',async()=>{
 const f=fixture(),values=[tokens(),tokens()];await Promise.all(values.map(value=>f.verify(value,nonce)));assert.equal(new Set(f.registered.map(x=>x.tokenId)).size,2);
});
test('missing persistence and unsafe account configuration reject before callback',()=>{
 assert.throws(()=>createCognitoInitialSessionVerifier(config,{async findActive(){return null;}},{} as InitialCognitoSessionStore),/persistence/);
 const store={async registerVerified(){},async isActive(){return false;}};
 assert.throws(()=>createCognitoInitialSessionVerifier({...config,account:'265544358665'},{async findActive(){return null;}},store),/boundary/);
});

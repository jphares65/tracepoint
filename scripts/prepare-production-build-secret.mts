import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {validateProductionTarget,verifyProductionIdentity,type ProductionTarget} from '../infra/lib/production-target.ts';
import {productionBuildSecretKeys,productionRuntimeSecretKeys,validateProductionBuildSecret} from './production-publication-core.mjs';

const args=process.argv.slice(2),index=args.indexOf('--config');
assert.ok(index>=0&&args[index+1],'Reviewed non-secret production target file required');
const target:ProductionTarget=validateProductionTarget(JSON.parse(readFileSync(args[index+1],'utf8').replace(/^\uFEFF/,'')),{offline:true});
function aws(argv:string[]){try{return JSON.parse(execFileSync('aws.exe',[...argv,'--region','us-east-1','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch{throw Error('Production build-secret operation failed; sensitive details suppressed');}}
function gate(){assert.equal(process.env.TRACEPOINT_PRODUCTION_AUTHORIZATION,target.deploymentAuthorization?.reference,'Production approval reference mismatch');verifyProductionIdentity(target,aws(['sts','get-caller-identity']),process.env.AWS_REGION??process.env.AWS_DEFAULT_REGION??'');}
const existing=(()=>{try{return JSON.parse(aws(['secretsmanager','get-secret-value','--secret-id','tracepoint/production/application']).SecretString);}catch{return {};}})();
const aesCandidate=existing.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
const aesValid=typeof aesCandidate==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(aesCandidate)&&[16,24,32].includes(Buffer.from(aesCandidate,'base64').length);
const publicUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.ok(publicUrl&&publicKey,'Production Supabase public configuration is unavailable');
const buildSecret:Record<string,string>={
 NEXT_PUBLIC_SUPABASE_URL:publicUrl,
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:publicKey,
 NEXT_PUBLIC_SITE_URL:'https://tracepointhq.com',
 NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:aesValid?aesCandidate:randomBytes(32).toString('base64'),
};
validateProductionBuildSecret(buildSecret);
const response=await fetch(buildSecret.NEXT_PUBLIC_SUPABASE_URL+'/auth/v1/settings',{headers:{apikey:buildSecret.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY},redirect:'error',signal:AbortSignal.timeout(15000)}).catch(()=>null);
assert.ok(response?.ok,'Production Supabase public probe failed; secret was not written');await response.body?.cancel();
const retained=Object.fromEntries(productionRuntimeSecretKeys.filter(key=>!productionBuildSecretKeys.includes(key)&&typeof existing[key]==='string'&&existing[key].trim()).map(key=>[key,existing[key]]));
const next={...retained,...buildSecret};gate();
const write=aws(['secretsmanager','put-secret-value','--secret-id','tracepoint/production/application','--secret-string',JSON.stringify(next)]);
const readback=JSON.parse(aws(['secretsmanager','get-secret-value','--secret-id','tracepoint/production/application','--version-id',write.VersionId]).SecretString);validateProductionBuildSecret(readback);
for(const key of Object.keys(next))assert.equal(readback[key],next[key],'Production build-secret readback mismatch');
console.log(JSON.stringify({target:'production',version:write.VersionId,buildFieldsVerified:productionBuildSecretKeys.length,runtimeReady:productionRuntimeSecretKeys.every(key=>typeof readback[key]==='string'&&readback[key].trim().length>0),secretValuesPrinted:false}));

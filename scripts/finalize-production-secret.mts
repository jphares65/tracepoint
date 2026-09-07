import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {validateProductionTarget,verifyProductionIdentity,type ProductionTarget} from '../infra/lib/production-target.ts';
import {assembleProductionRuntimeSecret,productionRuntimeSecretKeys} from './production-publication-core.mjs';

const args=process.argv.slice(2),index=args.indexOf('--config');assert.ok(index>=0&&args[index+1],'Reviewed non-secret production target file required');
const target:ProductionTarget=validateProductionTarget(JSON.parse(readFileSync(args[index+1],'utf8').replace(/^\uFEFF/,'')),{offline:true});
function aws(argv:string[]){try{return JSON.parse(execFileSync('aws.exe',[...argv,'--profile','tracepoint-production','--region','us-east-1','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch{throw Error('Production secret operation failed; sensitive details suppressed');}}
function gate(){assert.equal(process.env.TRACEPOINT_PRODUCTION_AUTHORIZATION,target.deploymentAuthorization?.reference,'Production approval reference mismatch');verifyProductionIdentity(target,aws(['sts','get-caller-identity']),process.env.AWS_REGION??process.env.AWS_DEFAULT_REGION??'');}
let input='';for await(const chunk of process.stdin)input+=chunk;const brevoKey=input.trim();assert.ok(brevoKey,'A concealed Brevo key is required');
gate();const existing=JSON.parse(aws(['secretsmanager','get-secret-value','--secret-id','tracepoint/production/application']).SecretString);
const secret=assembleProductionRuntimeSecret(existing,process.env,brevoKey,randomBytes(32).toString('base64'));
async function probe(url:string,headers:Record<string,string>){const response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(15000)}).catch(()=>null);assert.ok(response?.ok,'Production provider probe failed; secret was not written');await response.body?.cancel();}
await probe(secret.NEXT_PUBLIC_SUPABASE_URL+'/auth/v1/settings',{apikey:secret.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY});
await probe(secret.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/',{apikey:secret.SUPABASE_SECRET_KEY,Authorization:'Bearer '+secret.SUPABASE_SECRET_KEY,Accept:'application/openapi+json'});
await probe('https://api.brevo.com/v3/account',{'api-key':secret.BREVO_API_KEY});gate();
const write=aws(['secretsmanager','put-secret-value','--secret-id','tracepoint/production/application','--secret-string',JSON.stringify(secret)]);
const readback=JSON.parse(aws(['secretsmanager','get-secret-value','--secret-id','tracepoint/production/application','--version-id',write.VersionId]).SecretString);
assert.deepEqual(readback,secret,'Production secret readback mismatch');
console.log(JSON.stringify({target:'production',version:write.VersionId,runtimeFieldsVerified:productionRuntimeSecretKeys.length,runtimeReady:true,providerProbesPassed:3,secretValuesPrinted:false}));

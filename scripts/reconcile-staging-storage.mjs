import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {attachmentPathFromMetadata} from '../src/lib/storage/object-store-core.ts';
import {departmentPatchPathFromMetadata} from '../src/lib/storage/s3-object-store-core.ts';
import {reconcileStorageObjects} from './storage-reconciliation.mjs';
const args=process.argv.slice(2);const department=args[args.indexOf('--department')+1];const copy=args.includes('--execute-copy');
if(!args.includes('--department')||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(department))throw new Error('Explicit staging department UUID required');
const env={...process.env,AWS_REGION:'us-east-1',AWS_DEFAULT_REGION:'us-east-1'};
function aws(args){return JSON.parse(execFileSync('aws.exe',[...args,'--region','us-east-1','--output','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
function gate(){const id=aws(['sts','get-caller-identity']);if(id.Account!=='559054714699'||!id.Arn.includes('TracePointMigrationStaging'))throw new Error('Staging identity mismatch');}
const s3=new S3Client({region:'us-east-1',maxAttempts:1});
try{
 gate();let secret;try{secret=JSON.parse(aws(['secretsmanager','get-secret-value','--secret-id','tracepoint/staging/application']).SecretString);}catch{throw new Error('Staging secret unavailable');}
 if(secret.CONFIGURATION_ENVIRONMENT!=='staging'||secret.NEXT_PUBLIC_SUPABASE_URL!=='https://wztqqqashilusoppddxi.supabase.co')throw new Error('Staging source mismatch');
 const source=createClient(secret.NEXT_PUBLIC_SUPABASE_URL,secret.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const tenant=await source.from('departments').select('id').eq('id',department).maybeSingle();if(tenant.error||!tenant.data)throw new Error('Staging department unavailable');
 const keys=[];const lookup=new Map();
 for(const [bucket,prefix] of [['tracepoint-attachments','attachments'],['department-assets','department-assets']]){
  const pending=[department];
  while(pending.length){const directory=pending.pop();for(let offset=0;;offset+=100){const result=await source.storage.from(bucket).list(directory,{limit:100,offset,sortBy:{column:'name',order:'asc'}});if(result.error)throw new Error('Source inventory failed');for(const item of result.data){const path=directory+'/'+item.name;if(!item.id){if(!item.name||item.name==='.'||item.name==='..'||item.name.includes('/')||item.name.includes('\\')||pending.length>1000)throw new Error('Invalid source directory');pending.push(path);continue;}const valid=bucket==='tracepoint-attachments'?attachmentPathFromMetadata(path,department):departmentPatchPathFromMetadata(path,department);if(!valid)throw new Error('Invalid tenant object path');if(Number(item.metadata?.size)>25*1024*1024)throw new Error('Object exceeds bounded rehearsal size');const key=prefix+'/'+path;keys.push(key);lookup.set(key,{bucket,path,type:item.metadata?.mimetype||'application/octet-stream'});if(keys.length>10000)throw new Error('Inventory exceeds bounded rehearsal size');}if(result.data.length<100)break;}}
 }
 const target={Bucket:'tracepoint-staging-private-559054714699',ExpectedBucketOwner:'559054714699'};
 if(copy)gate();
 const report=await reconcileStorageObjects({keys,copy,source:{read:async key=>{const item=lookup.get(key);const result=await source.storage.from(item.bucket).download(item.path);if(result.error||!result.data||result.data.size>25*1024*1024)throw new Error('Source download failed');return new Uint8Array(await result.data.arrayBuffer());}},target:{read:async key=>{try{const result=await s3.send(new GetObjectCommand({...target,Key:key}));return new Uint8Array(await result.Body.transformToByteArray());}catch(error){if(error?.$metadata?.httpStatusCode===404)return null;throw new Error('Destination read failed');}},create:async(key,bytes)=>{await s3.send(new PutObjectCommand({...target,Key:key,Body:bytes,ContentType:lookup.get(key).type,IfNoneMatch:'*',ServerSideEncryption:'AES256'}));}}});
 console.log(JSON.stringify({sourceProject:'wztqqqashilusoppddxi',destinationAccount:'559054714699',copyAuthorized:copy,...report},null,2));
 if(!report.verified)process.exitCode=2;
}catch{console.error('Staging storage reconciliation failed; object names, contents and credentials suppressed. No conflicting object was overwritten.');process.exitCode=1;}finally{s3.destroy();}

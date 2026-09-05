import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { S3Client, GetPublicAccessBlockCommand, GetBucketVersioningCommand, GetBucketEncryptionCommand, ListObjectVersionsCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3ObjectStore } from '../src/lib/storage/s3-object-store-core.ts';
if(!process.argv.includes('--execute'))throw new Error('Use --execute for uniquely scoped disposable S3 checks');
const env={...process.env,AWS_REGION:'us-east-1',AWS_DEFAULT_REGION:'us-east-1'};
function identity(){const value=JSON.parse(execFileSync('aws.exe',['sts','get-caller-identity','--region','us-east-1','--output','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));if(value.Account!=='559054714699'||!value.Arn.includes('TracePointMigrationStaging'))throw new Error('Staging identity mismatch');}
identity();
const target={Bucket:'tracepoint-staging-private-559054714699',ExpectedBucketOwner:'559054714699'};
const client=new S3Client({region:'us-east-1',maxAttempts:1});
const run=randomUUID();const prefixes=['attachments/'+run+'/','department-assets/'+run+'/'];
const store=new S3ObjectStore(client,target.Bucket,target.ExpectedBucketOwner,run);
const bytes=new TextEncoder().encode('TracePoint disposable staging S3 contract check '+run);
const digest=value=>createHash('sha256').update(value).digest('hex');
let passed=false;
try {
 const access=await client.send(new GetPublicAccessBlockCommand(target));assert.ok(Object.values(access.PublicAccessBlockConfiguration??{}).length===4&&Object.values(access.PublicAccessBlockConfiguration).every(Boolean));
 assert.equal((await client.send(new GetBucketVersioningCommand(target))).Status,'Enabled');
 assert.equal((await client.send(new GetBucketEncryptionCommand(target))).ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm,'AES256');
 identity();
 for(const method of ['uploadQualificationEvidence','uploadTrainingFile','uploadFirearmAttachment','uploadDrillDocument']){
  const result=await store[method]({departmentId:run,recordId:randomUUID(),objectId:randomUUID(),fileName:'synthetic.txt',bytes,contentType:'text/plain'});assert.equal(result.error,null);
  const unsigned=await fetch('https://'+target.Bucket+'.s3.us-east-1.amazonaws.com/attachments/'+result.path,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(unsigned.status,403);
  const signed=await store.createAttachmentDownload(result.path,'synthetic.txt');assert.equal(signed.error,null);
  const response=await fetch(signed.signedUrl,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);assert.equal(digest(new Uint8Array(await response.arrayBuffer())),digest(bytes));
  assert.equal((await store.removeAttachment(result.path)).error,null);
  const missing=await store.createAttachmentView(result.path);assert.equal((await fetch(missing.signedUrl,{redirect:'error',signal:AbortSignal.timeout(15000)})).status,404);
  const versions=await client.send(new ListObjectVersionsCommand({...target,Prefix:'attachments/'+result.path}));
  const marker=versions.DeleteMarkers?.find(x=>x.Key==='attachments/'+result.path&&x.IsLatest);assert.ok(marker?.VersionId);
  await client.send(new DeleteObjectCommand({...target,Key:marker.Key,VersionId:marker.VersionId}));
  const restored=await store.createAttachmentView(result.path);const recovered=await fetch(restored.signedUrl,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(recovered.status,200);assert.equal(digest(new Uint8Array(await recovered.arrayBuffer())),digest(bytes));
  assert.equal((await store.removeAttachment(result.path)).error,null);
 }
 const patch=await store.uploadDepartmentPatch({departmentId:run,extension:'png',timestamp:Date.now(),bytes,contentType:'image/png'});assert.equal(patch.error,null);assert.ok((await store.createDepartmentPatchDelivery(patch.path)).signedUrl.startsWith('/api/'));
 const patchView=await store.createDepartmentPatchView(patch.path);const response=await fetch(patchView.signedUrl,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);assert.equal(digest(new Uint8Array(await response.arrayBuffer())),digest(bytes));assert.equal((await store.removeDepartmentPatch(patch.path)).error,null);
 passed=true;console.log(JSON.stringify({run,privateControls:'verified',uploadDownloadDelete:'verified',sha256Reconciliation:'verified',versionRestore:'verified',anonymousRead:'denied',domains:5}));
} catch {console.error('Staging S3 contract check failed; sensitive details suppressed.');process.exitCode=1;}
finally {
 try {
  identity();
  for(const Prefix of prefixes){
   const versions=await client.send(new ListObjectVersionsCommand({...target,Prefix}));if(versions.IsTruncated)throw new Error('Unexpected canary volume');
   for(const item of [...versions.Versions??[],...versions.DeleteMarkers??[]]){if(!item.Key?.startsWith(Prefix)||!item.VersionId)throw new Error('Cleanup scope mismatch');await client.send(new DeleteObjectCommand({...target,Key:item.Key,VersionId:item.VersionId}));}
   const remaining=await client.send(new ListObjectVersionsCommand({...target,Prefix}));assert.equal((remaining.Versions?.length??0)+(remaining.DeleteMarkers?.length??0),0);
  }
  console.log(JSON.stringify({run,cleanup:'verified zero versions and delete markers',passed}));
 }catch{console.error('Disposable S3 cleanup failed for printed run only; do not broaden deletion.');process.exitCode=1;}
 client.destroy();
}

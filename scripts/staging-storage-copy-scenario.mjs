import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { S3Client, ListObjectVersionsCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { storageHash } from './storage-reconciliation.mjs';

// Called only by the disposable staging fixture owner. Production source data
// is never accepted; all source objects are generated here and removed here.
export async function exerciseStorageCopy({admin,department,env,run}) {
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 const items=[{bucket:'tracepoint-attachments',prefix:'attachments',path:`${department}/drill-document/${randomUUID()}/${randomUUID()}-synthetic.png`},
  {bucket:'department-assets',prefix:'department-assets',path:`${department}/patch-${Date.now()}.png`}];
 const s3=new S3Client({region:'us-east-1',maxAttempts:1});
 const target={Bucket:'tracepoint-staging-private-559054714699',ExpectedBucketOwner:'559054714699'};
 function gate(){const id=JSON.parse(execFileSync('aws.exe',['sts','get-caller-identity','--region','us-east-1','--output','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.equal(id.Account,'559054714699');assert.match(id.Arn,/^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);}
 function reconcile(copy){const child=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('./reconcile-staging-storage.mjs',import.meta.url)),'--department',department,...copy?['--execute-copy']:[]],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});assert.equal(child.status,copy?0:2);return JSON.parse(child.stdout);}
 const uploaded=[];
 try {
  gate();
  for(const item of items){uploaded.push(item);const result=await admin.storage.from(item.bucket).upload(item.path,bytes,{contentType:'image/png',upsert:false});assert.equal(result.error,null);}
  const before=reconcile(false);assert.equal(before.count,2);assert.equal(before.verified,false);
  const copied=reconcile(true);assert.equal(copied.verified,true);assert.equal(copied.objects.every(x=>x.created),true);
  const repeated=reconcile(true);assert.equal(repeated.sha256,copied.sha256);assert.equal(repeated.objects.every(x=>!x.created),true);
  gate();
  for(const item of items){
   const Key=item.prefix+'/'+item.path;const versions=await s3.send(new ListObjectVersionsCommand({...target,Prefix:Key}));
   assert.equal(versions.IsTruncated,false);assert.equal(versions.Versions?.length,1);assert.equal(versions.Versions[0].Key,Key);assert.ok(versions.Versions[0].VersionId);
   // Roll back only the exact immutable version created in this rehearsal.
   await s3.send(new DeleteObjectCommand({...target,Key,VersionId:versions.Versions[0].VersionId}));
   await assert.rejects(s3.send(new GetObjectCommand({...target,Key})),error=>error?.$metadata?.httpStatusCode===404);
   const source=await admin.storage.from(item.bucket).download(item.path);assert.equal(source.error,null);assert.equal(storageHash(new Uint8Array(await source.data.arrayBuffer())),storageHash(bytes));
  }
  gate();const returned=reconcile(true);assert.equal(returned.verified,true);assert.equal(returned.sha256,copied.sha256);
  console.log(JSON.stringify({fixtureRun:run,storageCopy:{objects:2,sha256Verified:true,idempotent:true,versionScopedRollback:true,sourcePreserved:true,returnedToCopiedState:true}}));
 } finally {
  let failed=false;
  for(const item of uploaded){const removed=await admin.storage.from(item.bucket).remove([item.path]);const slash=item.path.lastIndexOf('/');const listed=await admin.storage.from(item.bucket).list(item.path.slice(0,slash),{limit:100});if(removed.error||listed.error||listed.data?.some(x=>x.name===item.path.slice(slash+1)))failed=true;}
  s3.destroy();if(failed)throw Error('Synthetic source storage cleanup failed.');
  console.log(JSON.stringify({fixtureRun:run,sourceStorageCleanup:'verified'}));
 }
}

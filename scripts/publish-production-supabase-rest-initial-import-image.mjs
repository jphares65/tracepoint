import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { productionRestInitialImportArchivePaths, validateCleanProductionScan, validateProductionRestInitialImportArchive } from './production-publication-core.mjs';

const root=resolve(import.meta.dirname,'..');
const command=(program,args)=>{try{return execFileSync(program,args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{throw new Error('REST initial-import image publication failed; command detail suppressed');}};
const aws=args=>JSON.parse(command('aws.exe',[...args,'--region','us-east-1','--output','json']));
assert.equal(process.env.TRACEPOINT_FINAL_MIGRATION_DB_AUTHORIZATION,'TP-FINAL-DB-20260920-4272874FBAE4','Approved final migration database authorization is required');
assert.equal(process.env.AWS_PROFILE,'tracepoint-production','Only the reviewed production AWS profile is permitted');
const identity=aws(['sts','get-caller-identity']);assert.equal(identity.Account,'193644343389');assert.match(identity.Arn,/^arn:aws:sts::193644343389:assumed-role\/TracePointMigrationProduction\//);
const commit=command('git.exe',['rev-parse','HEAD']),tag=`${commit}-supabase-rest-initial-import`;
assert.equal(command('git.exe',['status','--porcelain','--untracked-files=no','--',...productionRestInitialImportArchivePaths]),'','REST initial-import archive source has tracked changes');
const repository=aws(['ecr','describe-repositories','--repository-names','tracepoint-production']).repositories[0];assert.equal(repository.registryId,'193644343389');assert.equal(repository.imageTagMutability,'IMMUTABLE');
const directory=mkdtempSync(join(tmpdir(),'tracepoint-rest-import-')),archive=join(directory,'source.zip');
try{
 command('git.exe',['archive','--format=zip',`--output=${archive}`,commit,'--',...productionRestInitialImportArchivePaths]);
 const entries=command('tar.exe',['-tf',archive]).split(/\r?\n/).filter(entry=>!entry.endsWith('/'));const tracked=new Set(command('git.exe',['ls-tree','-r','--name-only',commit]).split(/\r?\n/));validateProductionRestInitialImportArchive(entries,tracked);
 const existing=aws(['ecr','batch-get-image','--repository-name','tracepoint-production','--image-ids',`imageTag=${tag}`]);
 if(existing.images?.length===1){const scan=aws(['ecr','describe-image-scan-findings','--repository-name','tracepoint-production','--image-id',`imageTag=${tag}`]);validateCleanProductionScan(scan);console.log(JSON.stringify({existingImmutableImage:true,sourceCommit:commit,imageTag:tag,imageDigest:existing.images[0].imageId.imageDigest,cleanScan:true}));}
 else {assert.ok(existing.failures?.length===1&&existing.failures[0].failureCode==='ImageNotFound','Unexpected image lookup result');const bucket='tracepoint-production-aws-native-build-source-193644343389';assert.equal(aws(['s3api','get-bucket-versioning','--bucket',bucket,'--expected-bucket-owner','193644343389']).Status,'Enabled');const version=aws(['s3api','put-object','--bucket',bucket,'--expected-bucket-owner','193644343389','--key','source/tracepoint-production-aws-native-source.zip','--body',archive]).VersionId;assert.ok(version&&version!=='null');const build=aws(['codebuild','start-build','--project-name','tracepoint-production-aws-native-image-build','--source-version',version,'--buildspec-override','buildspec.supabase-rest-initial-import.yml','--environment-variables-override',`name=IMAGE_TAG,value=${tag},type=PLAINTEXT`,`name=SOURCE_COMMIT,value=${commit},type=PLAINTEXT`]).build;assert.equal(build.arn.split(':')[4],'193644343389');console.log(JSON.stringify({buildId:build.id,sourceCommit:commit,imageTag:tag}));const deadline=Date.now()+2_700_000;for(;;){const status=aws(['codebuild','batch-get-builds','--ids',build.id]).builds[0].buildStatus;if(status==='SUCCEEDED')break;assert.equal(status,'IN_PROGRESS','REST initial-import image build failed');assert.ok(Date.now()<deadline,'REST initial-import image build timed out');await new Promise(resolveWait=>setTimeout(resolveWait,20_000));}command('aws.exe',['ecr','wait','image-scan-complete','--repository-name','tracepoint-production','--image-id',`imageTag=${tag}`,'--region','us-east-1']);const scan=aws(['ecr','describe-image-scan-findings','--repository-name','tracepoint-production','--image-id',`imageTag=${tag}`]);validateCleanProductionScan(scan);assert.match(scan.imageId.imageDigest,/^sha256:[0-9a-f]{64}$/);console.log(JSON.stringify({imagePublished:true,sourceCommit:commit,imageTag:tag,imageDigest:scan.imageId.imageDigest,cleanScan:true}));}
}finally{rmSync(directory,{recursive:true,force:true});}

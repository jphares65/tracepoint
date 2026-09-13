import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { validateFullAwsProductionTarget, verifyFullAwsProductionIdentity, type FullAwsProductionTarget } from '../infra/lib/full-aws-production-target.ts';
import { productionIdentityMigrationArchivePaths, validateCleanProductionScan, validateProductionIdentityMigrationArchive } from './production-publication-core.mjs';

const args=process.argv.slice(2),configIndex=args.indexOf('--config');
assert.ok(configIndex>=0&&args[configIndex+1],'Reviewed full-AWS production target file required');
const offline=args.includes('--validate-archive-only');
const evidenceIndex=args.indexOf('--evidence-output'),evidencePath=evidenceIndex>=0?args[evidenceIndex+1]:'';
if(!offline)assert.ok(evidencePath,'--evidence-output is required for production publication');
const target:FullAwsProductionTarget=validateFullAwsProductionTarget(JSON.parse(readFileSync(args[configIndex+1],'utf8').replace(/^\uFEFF/,'')),{offline});
const root=resolve(import.meta.dirname,'..');
const command=(program:string,argv:string[])=>{try{return execFileSync(program,argv,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{throw new Error('Production identity-image publication command failed; details suppressed');}};
const aws=(argv:string[])=>JSON.parse(command('aws.exe',[...argv,'--region','us-east-1','--output','json']));
const gate=()=>{assert.equal(process.env.TRACEPOINT_PRODUCTION_AUTHORIZATION,target.deploymentAuthorization?.reference,'Production approval reference mismatch');verifyFullAwsProductionIdentity(target,aws(['sts','get-caller-identity']),process.env.AWS_REGION??process.env.AWS_DEFAULT_REGION??'');};
const commit=command('git.exe',['rev-parse','HEAD']),tag=`${commit}-identity-migration`;
assert.equal(target.imageTag,`${commit}-aws-native`,'Identity and runtime images must use one reviewed source commit');
assert.equal(command('git.exe',['status','--porcelain','--untracked-files=no','--',...productionIdentityMigrationArchivePaths]),'','Production identity archive source has tracked changes');
if(!offline){gate();const repository=aws(['ecr','describe-repositories','--repository-names','tracepoint-production']).repositories[0];assert.equal(repository.registryId,target.account);assert.equal(repository.imageTagMutability,'IMMUTABLE');}

const directory=mkdtempSync(join(tmpdir(),'tracepoint-production-identity-image-')),archive=join(directory,'source.zip');
try{
 command('git.exe',['archive','--format=zip',`--output=${archive}`,`--add-virtual-file=TRACEPOINT_SOURCE_COMMIT:${commit}`,commit,'--',...productionIdentityMigrationArchivePaths,':(glob,exclude)**/*.backup-*',':(glob,exclude)**/*.encoding-backup-*',':(glob,exclude)**/*.before-*',':(glob,exclude)**/*.bak',':(glob,exclude)**/*.bak-*']);
 const sourceArchiveSha256=createHash('sha256').update(readFileSync(archive)).digest('hex');
 const entries=command('tar.exe',['-tf',archive]).split(/\r?\n/).filter(entry=>!entry.endsWith('/'));
 const tracked=new Set(command('git.exe',['ls-tree','-r','--name-only',commit]).split(/\r?\n/));
 const count=validateProductionIdentityMigrationArchive(entries,tracked);
 console.log(JSON.stringify({archiveValidated:true,sourceCommit:commit,imageTag:tag,trackedFiles:count,standardCohorts:true,exceptionalCohorts:true,productionMutation:false}));
 if(!offline){
  const existing=aws(['ecr','batch-get-image','--repository-name','tracepoint-production','--image-ids',`imageTag=${tag}`]);
  if(existing.images?.length===1){
   const scan=aws(['ecr','describe-image-scan-findings','--repository-name','tracepoint-production','--image-id',`imageTag=${tag}`]);validateCleanProductionScan(scan);
   const evidence=JSON.parse(readFileSync(resolve(evidencePath),'utf8').replace(/^\uFEFF/,''));
   assert.deepEqual({account:evidence.account,region:evidence.region,commit:evidence.commit,imageTag:evidence.imageTag,sourceArchiveSha256:evidence.sourceArchiveSha256,buildStatus:evidence.buildStatus,scanStatus:evidence.scanStatus,imageDigest:evidence.imageDigest},{account:target.account,region:'us-east-1',commit,imageTag:tag,sourceArchiveSha256,buildStatus:'SUCCEEDED',scanStatus:'COMPLETE',imageDigest:existing.images[0].imageId.imageDigest},'Existing identity image evidence does not match the immutable source');
   assert.match(evidence.buildId??'',/^tracepoint-production-aws-native-image-build:/);assert.ok(evidence.sourceVersion&&evidence.sourceVersion!=='null');
   const build=aws(['codebuild','batch-get-builds','--ids',evidence.buildId]).builds[0];
   const sourceCommit=(build.environment?.environmentVariables??[]).find((value:{name?:string})=>value.name==='SOURCE_COMMIT')?.value;
   assert.equal(build.buildStatus,'SUCCEEDED');assert.equal(build.sourceVersion,evidence.sourceVersion);assert.equal(build.buildspec,'buildspec.identity-migration.yml');assert.equal(sourceCommit,commit);
   console.log(JSON.stringify({existingImmutableImage:true,sourceCommit:commit,imageDigest:existing.images[0].imageId.imageDigest,sourceArchiveSha256,cleanScan:true,buildEvidenceValidated:true}));
  }
  else{
   assert.ok(existing.failures?.length===1&&existing.failures[0].failureCode==='ImageNotFound','Existing identity image lookup failed');
   gate();const bucket=`tracepoint-production-aws-native-build-source-${target.account}`;
   assert.equal(aws(['s3api','get-bucket-versioning','--bucket',bucket,'--expected-bucket-owner',target.account]).Status,'Enabled');
   const version=aws(['s3api','put-object','--bucket',bucket,'--expected-bucket-owner',target.account,'--key','source/tracepoint-production-aws-native-source.zip','--body',archive]).VersionId;assert.ok(version&&version!=='null');
   gate();const build=aws(['codebuild','start-build','--project-name','tracepoint-production-aws-native-image-build','--source-version',version,'--buildspec-override','buildspec.identity-migration.yml','--environment-variables-override',`name=IMAGE_TAG,value=${tag},type=PLAINTEXT`,`name=SOURCE_COMMIT,value=${commit},type=PLAINTEXT`]).build;
   assert.equal(build.arn.split(':')[4],target.account);console.log(JSON.stringify({buildId:build.id,sourceVersion:version,sourceCommit:commit,imageTag:tag}));
   const deadline=Date.now()+2_700_000;for(;;){const status=aws(['codebuild','batch-get-builds','--ids',build.id]).builds[0].buildStatus;if(status==='SUCCEEDED')break;assert.equal(status,'IN_PROGRESS','Production identity image build failed');assert.ok(Date.now()<deadline,'Production identity image build timed out');await new Promise(resolveWait=>setTimeout(resolveWait,20_000));}
   command('aws.exe',['ecr','wait','image-scan-complete','--repository-name','tracepoint-production','--image-id',`imageTag=${tag}`,'--region','us-east-1']);
   const scan=aws(['ecr','describe-image-scan-findings','--repository-name','tracepoint-production','--image-id',`imageTag=${tag}`]);validateCleanProductionScan(scan);assert.match(scan.imageId.imageDigest,/^sha256:[0-9a-f]{64}$/);
   const findings=scan.imageScanFindings.findingSeverityCounts??{};
   const evidence={format:1,account:target.account,region:'us-east-1',commit,imageTag:tag,sourceVersion:version,sourceArchiveSha256,buildId:build.id,buildStatus:'SUCCEEDED',imageDigest:scan.imageId.imageDigest,scanStatus:'COMPLETE',criticalFindings:findings.CRITICAL??0,highFindings:findings.HIGH??0};
   writeFileSync(resolve(evidencePath),`${JSON.stringify(evidence,null,2)}\n`,{encoding:'utf8',flag:'wx'});
   console.log(JSON.stringify({productionIdentityImagePublished:true,sourceCommit:commit,imageTag:tag,imageDigest:scan.imageId.imageDigest,sourceArchiveSha256,buildEvidenceWritten:true,standardCohorts:true,exceptionalCohorts:true,cleanScan:true,identitiesChanged:false,emailSent:false}));
  }
 }
}finally{rmSync(directory,{recursive:true,force:true});}

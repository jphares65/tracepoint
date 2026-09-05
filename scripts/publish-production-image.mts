import {execFileSync} from 'node:child_process';import {readFileSync,mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import assert from 'node:assert/strict';
import {validateProductionTarget,verifyProductionIdentity,type ProductionTarget} from '../infra/lib/production-target.ts';
import {productionArchivePaths,validateProductionArchive,validateProductionSecret,validateCleanProductionScan} from './production-publication-core.mjs';
const args=process.argv.slice(2),index=args.indexOf('--config');assert.ok(index>=0&&args[index+1],'Reviewed non-secret production target file required');
const offline=args.includes('--validate-archive-only');const target:ProductionTarget=validateProductionTarget(JSON.parse(readFileSync(args[index+1],'utf8').replace(/^\uFEFF/,'')),{offline});
const root=resolve(import.meta.dirname,'..');
function command(program:string,argv:string[]){try{return execFileSync(program,argv,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{throw Error('Production publication command failed; details suppressed');}}
function aws(argv:string[]){try{return JSON.parse(command('aws.exe',[...argv,'--region','us-east-1','--output','json']));}catch{throw Error('Production AWS operation failed; details suppressed');}}
function identityGate(){if(process.env.TRACEPOINT_PRODUCTION_AUTHORIZATION!==target.deploymentAuthorization?.reference)throw Error('Production approval reference mismatch');verifyProductionIdentity(target,aws(['sts','get-caller-identity']),process.env.AWS_REGION??process.env.AWS_DEFAULT_REGION??'');}
const commit=command('git.exe',['rev-parse','HEAD']);assert.equal(commit,target.imageTag,'Production image tag must identify the reviewed source checkout');
assert.equal(command('git.exe',['status','--porcelain','--untracked-files=no','--',...productionArchivePaths]),'','Production archive source has tracked changes');
if(!offline){
 identityGate();let secret;try{secret=JSON.parse(aws(['secretsmanager','get-secret-value','--secret-id','tracepoint/production/application']).SecretString);}catch{throw Error('Production secret could not be decoded; details suppressed');}validateProductionSecret(secret);
 async function probe(url:string,headers:Record<string,string>){try{const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});await r.body?.cancel();assert.ok(r.ok);}catch{throw Error('Production provider authentication probe failed; no source published');}}
 await probe(secret.NEXT_PUBLIC_SUPABASE_URL+'/auth/v1/settings',{apikey:secret.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY});
 await probe(secret.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/',{apikey:secret.SUPABASE_SECRET_KEY,Authorization:'Bearer '+secret.SUPABASE_SECRET_KEY,Accept:'application/openapi+json'});
 await probe('https://api.brevo.com/v3/account',{'api-key':secret.BREVO_API_KEY});
 const repo=aws(['ecr','describe-repositories','--repository-names','tracepoint-production']).repositories[0];assert.equal(repo.registryId,target.account);assert.equal(repo.imageTagMutability,'IMMUTABLE');
}
const directory=mkdtempSync(join(tmpdir(),'tracepoint-production-archive-')),archive=join(directory,'source.zip');
try{
 command('git.exe',['archive','--format=zip','--output='+archive,commit,'--',...productionArchivePaths,':(glob,exclude)**/*.backup-*',':(glob,exclude)**/*.encoding-backup-*',':(glob,exclude)**/*.before-*',':(glob,exclude)**/*.bak',':(glob,exclude)**/*.bak-*']);
 const entries=command('tar.exe',['-tf',archive]).split(/\r?\n/).filter(x=>!x.endsWith('/'));const tracked=new Set(command('git.exe',['ls-tree','-r','--name-only',commit]).split(/\r?\n/));const count=validateProductionArchive(entries,tracked);
 console.log(JSON.stringify({archiveValidated:true,sourceCommit:commit,trackedFiles:count,productionMutation:false}));
 if(!offline){
  const existing=aws(['ecr','batch-get-image','--repository-name','tracepoint-production','--image-ids','imageTag='+commit]);
  if(existing.images?.length===1){const scan=aws(['ecr','describe-image-scan-findings','--repository-name','tracepoint-production','--image-id','imageTag='+commit]);validateCleanProductionScan(scan);console.log(JSON.stringify({existingImmutableImage:true,sourceCommit:commit,imageDigest:existing.images[0].imageId.imageDigest,cleanScan:true,productionMutation:false}));}
  else {
  assert.ok(existing.failures?.length===1&&existing.failures[0].failureCode==='ImageNotFound','Existing production image lookup failed');
  const bucket='tracepoint-production-build-source-'+target.account;assert.equal(aws(['s3api','get-bucket-versioning','--bucket',bucket,'--expected-bucket-owner',target.account]).Status,'Enabled');
  identityGate();const version=aws(['s3api','put-object','--bucket',bucket,'--expected-bucket-owner',target.account,'--key','source/tracepoint-production-source.zip','--body',archive]).VersionId;assert.ok(version&&version!=='null');
  identityGate();const build=aws(['codebuild','start-build','--project-name','tracepoint-production-image-build','--source-version',version,'--environment-variables-override','name=IMAGE_TAG,value='+commit+',type=PLAINTEXT','name=SOURCE_COMMIT,value='+commit+',type=PLAINTEXT']).build;assert.equal(build.arn.split(':')[4],target.account);console.log(JSON.stringify({buildId:build.id,sourceVersion:version,sourceCommit:commit}));
  const deadline=Date.now()+2700000;for(;;){const status=aws(['codebuild','batch-get-builds','--ids',build.id]).builds[0].buildStatus;if(status==='SUCCEEDED')break;assert.equal(status,'IN_PROGRESS','Production build failed');assert.ok(Date.now()<deadline,'Production build timed out');await new Promise(r=>setTimeout(r,20000));}
  command('aws.exe',['ecr','wait','image-scan-complete','--repository-name','tracepoint-production','--image-id','imageTag='+commit,'--region','us-east-1']);const scan=aws(['ecr','describe-image-scan-findings','--repository-name','tracepoint-production','--image-id','imageTag='+commit]);validateCleanProductionScan(scan);assert.match(scan.imageId.imageDigest,/^sha256:[0-9a-f]{64}$/);console.log(JSON.stringify({productionImagePublished:true,sourceCommit:commit,imageDigest:scan.imageId.imageDigest,cleanScan:true,runtimeDeployed:false,dnsChanged:false}));
  }
 }
}finally{try{unlinkSync(archive);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}rmdirSync(directory);}

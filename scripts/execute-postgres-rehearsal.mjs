import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const execute=promisify(execFile);
const account='559054714699',region='us-east-1';
const allowed=new Set(['AWS::EC2::VPC','AWS::EC2::Subnet','AWS::EC2::RouteTable','AWS::EC2::SubnetRouteTableAssociation','AWS::EC2::Route','AWS::EC2::InternetGateway','AWS::EC2::VPCGatewayAttachment','AWS::EC2::SecurityGroup','AWS::EC2::SecurityGroupIngress','AWS::KMS::Key','AWS::Logs::LogGroup','AWS::RDS::DBSubnetGroup','AWS::RDS::DBParameterGroup','AWS::RDS::DBInstance','AWS::ECS::Cluster','AWS::ECS::TaskDefinition','AWS::IAM::Role','AWS::IAM::Policy','AWS::CDK::Metadata']);
export function validateRehearsalTemplate(template,run){
 assert.match(run,/^[a-f0-9]{12}$/);const resources=Object.values(template.Resources);assert.ok(resources.length<60);
 assert.ok(resources.every(r=>allowed.has(r.Type)));
 const databases=resources.filter(r=>r.Type==='AWS::RDS::DBInstance');assert.equal(databases.length,1);
 const db=databases[0];assert.equal(db.Properties.DBInstanceIdentifier,'tp-rehearsal-'+run);assert.equal(db.Properties.PubliclyAccessible,false);assert.equal(db.Properties.StorageEncrypted,true);assert.equal(db.Properties.ManageMasterUserPassword,true);assert.equal(db.Properties.AllocatedStorage,'20');assert.equal(db.Properties.DBInstanceClass,'db.t4g.micro');assert.equal(db.DeletionPolicy,'Delete');
 assert.equal(resources.filter(r=>r.Type==='AWS::ECS::Cluster').length,1);
 assert.equal(resources.filter(r=>r.Type==='AWS::EC2::VPC').length,1);
 assert.ok(resources.every(r=>!JSON.stringify(r).includes('265544358665')));
}
export function validateOwnedStack(stack,run){
 assert.equal(stack.StackName,'tracepoint-postgres-rehearsal-'+run);
 assert.match(stack.StackId,new RegExp('^arn:aws:cloudformation:us-east-1:559054714699:stack/tracepoint-postgres-rehearsal-'+run+'/'));
 const tags=Object.fromEntries(stack.Tags.map(t=>[t.Key,t.Value]));assert.equal(tags.RehearsalRun,run);assert.equal(tags.Purpose,'disposable-synthetic-only');
}
async function main(){
 const args=process.argv.slice(2);assert.equal(args[0],'--execute');assert.equal(args[1],'--image');assert.equal(args.length,3);assert.match(args[2],/^[a-f0-9]{40}-postgres-rehearsal$/);
 assert.equal(process.env.AWS_REGION,region);assert.equal(process.env.AWS_DEFAULT_REGION,region);
 const env={...process.env,AWS_PAGER:'',AWS_CLI_OUTPUT_ENCODING:'UTF-8'};
 const aws=async parameters=>{try{return JSON.parse((await execute('aws.exe',[...parameters,'--region',region,'--output','json'],{env,maxBuffer:5*1024*1024,timeout:60000})).stdout||'null');}catch(error){const text=error.stderr||'';const safe=Error('AWS rehearsal operation failed: '+parameters.slice(0,2).join(' '));safe.awsCode=text.match(/\((\w+)\) when calling/)?.[1];safe.missing=safe.awsCode==='ValidationError'&&text.includes('does not exist');throw safe;}};
 const identity=async()=>{const id=await aws(['sts','get-caller-identity']);assert.equal(id.Account,account);assert.match(id.Arn,/^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);};
 await identity();const scan=await aws(['ecr','describe-image-scan-findings','--repository-name','tracepoint-staging','--image-id','imageTag='+args[2]]);assert.equal(scan.imageScanStatus.status,'COMPLETE');assert.ok(Object.values(scan.imageScanFindings.findingSeverityCounts).every(n=>n===0));
 const versions=await aws(['rds','describe-db-engine-versions','--engine','postgres','--engine-version','18.4']);assert.equal(versions.DBEngineVersions[0]?.Status,'available');
 const cost=JSON.parse(await readFile('docs/aws-cost-evidence-20260905.json','utf8'));assert.equal(cost.account,account);assert.equal(cost.budgetLimitUSD,75);assert.ok(Date.now()-Date.parse(cost.queriedAtUTC)<24*3600000);assert.ok(Number.isFinite(cost.modeledMonthlyUSD)&&cost.modeledMonthlyUSD+2<75);
 const run=randomBytes(6).toString('hex'),name='tracepoint-postgres-rehearsal-'+run,directory=await mkdtemp(path.join(tmpdir(),'tp-rehearsal-synth-'));let created=false,task,outputs,passed=false;const started=Date.now();
 const evidence={run,account,region,imageTag:args[2],imageDigest:scan.imageId.imageDigest,monthlyModelWithReserve:cost.modeledMonthlyUSD+2,maximumRunHours:2,startedAt:new Date().toISOString()};
 const stack=async()=>{const result=await aws(['cloudformation','describe-stacks','--stack-name',name]);const value=result.Stacks[0];validateOwnedStack(value,run);return value;};
 const pause=()=>new Promise(resolve=>setTimeout(resolve,15000));
 try{
  const command=`& npx.cmd cdk synth --app 'npx ts-node bin/postgres-rehearsal.ts' --strict --output '${directory.replaceAll("'","''")}' -c account=${account} -c region=${region} -c run=${run} -c imageDigest=${scan.imageId.imageDigest} -c engineVersion=18.4; exit $LASTEXITCODE`;
  try{await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{cwd:path.resolve('infra'),env,maxBuffer:5*1024*1024,timeout:180000});}catch{throw Error('Strict rehearsal synthesis failed; no resources created');}
  const templatePath=path.join(directory,name+'.template.json');const template=JSON.parse(await readFile(templatePath,'utf8'));validateRehearsalTemplate(template,run);
  try{await aws(['cloudformation','describe-stacks','--stack-name',name]);throw Error('Existing stack cannot be used for a disposable rehearsal');}catch(error){if(!error.missing)throw error;}
  // The existing monthly model is $57.17. This one bounded rehearsal reserves $2.
  // No recurring database/service or NAT is created. Unique stack must be absent.
  assert.ok(evidence.monthlyModelWithReserve<75);
  await identity();const result=await aws(['cloudformation','create-stack','--stack-name',name,'--template-body','file://'+templatePath,'--capabilities','CAPABILITY_IAM','--tags','Key=RehearsalRun,Value='+run,'Key=Purpose,Value=disposable-synthetic-only','Key=Environment,Value=staging','Key=Application,Value=TracePoint']);created=true;evidence.stackArn=result.StackId;
  const createDeadline=Date.now()+45*60000;
  for(;;){const current=await stack();if(current.StackStatus==='CREATE_COMPLETE'){outputs=Object.fromEntries(current.Outputs.map(o=>[o.OutputKey,o.OutputValue]));break;}if(current.StackStatus!=='CREATE_IN_PROGRESS'||Date.now()>createDeadline)throw Error('Disposable stack creation failed or timed out');await pause();}
  await identity();const launched=await aws(['ecs','run-task','--cluster',outputs.Cluster,'--task-definition',outputs.TaskDefinition,'--launch-type','FARGATE','--count','1','--network-configuration',`awsvpcConfiguration={subnets=[${outputs.RunnerSubnet}],securityGroups=[${outputs.RunnerSecurityGroup}],assignPublicIp=ENABLED}`]);assert.equal(launched.failures.length,0);assert.equal(launched.tasks.length,1);task=launched.tasks[0].taskArn;evidence.taskArn=task;
  const taskDeadline=Date.now()+15*60000;let exitCode;
  for(;;){const state=await aws(['ecs','describe-tasks','--cluster',outputs.Cluster,'--tasks',task]);assert.equal(state.failures.length,0);if(state.tasks[0].lastStatus==='STOPPED'){exitCode=state.tasks[0].containers[0].exitCode;break;}if(Date.now()>taskDeadline)throw Error('Disposable runner timed out');await pause();}
  const logs=await aws(['logs','filter-log-events','--log-group-name',outputs.RunnerLogGroup]);
  const results=logs.events.flatMap(e=>{try{return[JSON.parse(e.message)];}catch{return[];}});const proof=results.find(r=>r.rehearsal==='PASSED'&&r.run===run);evidence.runnerExitCode=exitCode;evidence.failureCodes=results.filter(r=>r.rehearsal==='FAILED'||r.failedMigration).map(r=>({sqlState:r.sqlState,failedMigration:r.failedMigration,errorName:r.errorName}));assert.equal(exitCode,0);assert.ok(proof,'Runner aggregate proof missing');evidence.result=proof;passed=true;
 }finally{
  if(created){
   await identity();await stack();
   if(task){const state=await aws(['ecs','describe-tasks','--cluster',outputs.Cluster,'--tasks',task]);if(state.tasks.some(t=>t.lastStatus!=='STOPPED')){await identity();await aws(['ecs','stop-task','--cluster',outputs.Cluster,'--task',task,'--reason','Bounded disposable rehearsal cleanup']);}}
   await identity();await aws(['cloudformation','delete-stack','--stack-name',name]);
   const cleanupDeadline=Date.now()+45*60000;
   for(;;){try{const current=await stack();if(current.StackStatus==='DELETE_COMPLETE')break;if(current.StackStatus==='DELETE_FAILED'||Date.now()>cleanupDeadline)throw Error('Disposable resource cleanup requires recovery');}catch(error){if(error.missing)break;throw error;}await pause();}
   evidence.cleanup='verified stack deletion';
  }
  evidence.elapsedSeconds=(Date.now()-started)/1000;evidence.passed=passed;
  await writeFile('docs/aws-postgres-rehearsal-evidence-20260905.json',JSON.stringify(evidence,null,2)+'\n');
  await rm(directory,{recursive:true,force:true});
  console.log(JSON.stringify(evidence));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({rehearsal:'FAILED',errorName:error.name,awsCode:error.awsCode,reason:error.message.startsWith('AWS rehearsal')?error.message:undefined}));process.exitCode=1;});

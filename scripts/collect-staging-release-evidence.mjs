import { execFileSync } from 'node:child_process';
const account='559054714699',region='us-east-1',base='https://staging.tracepointhq.com';
const args=process.argv.slice(2),tag=args[args.indexOf('--image')+1];
if(!args.includes('--image')||!/^[0-9a-f]{40}$/.test(tag))throw Error('Explicit immutable --image SHA required.');
const env={...process.env,AWS_REGION:region,AWS_DEFAULT_REGION:region,AWS_CLI_OUTPUT_ENCODING:'UTF-8'};
const report={account,region,imageTag:tag,checkedAt:new Date().toISOString()};
function aws(args){return JSON.parse(execFileSync(process.platform==='win32'?'aws.exe':'aws',[...args,'--region',region,'--output','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024}));}
try {
 const identity=aws(['sts','get-caller-identity']);
 if(identity.Account!==account||!/^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//.test(identity.Arn))throw Error('Identity boundary');
 report.identityVerified=true;
 const stack=aws(['cloudformation','describe-stacks','--stack-name','tracepoint-staging-runtime']).Stacks[0];report.stackStatus=stack.StackStatus;
 const service=aws(['ecs','describe-services','--cluster','tracepoint-staging','--services','tracepoint-staging']).services[0];
 report.ecs={desired:service.desiredCount,running:service.runningCount,pending:service.pendingCount,revision:Number(service.taskDefinition.split(':').at(-1)),completed:service.deployments.length===1&&service.deployments[0].rolloutState==='COMPLETED'};
 const scan=aws(['ecr','describe-image-scan-findings','--repository-name','tracepoint-staging','--image-id','imageTag='+tag]);
 report.scan={status:scan.imageScanStatus.status,findings:scan.imageScanFindings?.findingSeverityCounts??{}};report.expectedDigest=scan.imageId.imageDigest;
 const taskArns=aws(['ecs','list-tasks','--cluster','tracepoint-staging','--service-name','tracepoint-staging','--desired-status','RUNNING']).taskArns;
 if(taskArns.length!==1)throw Error('Task count');
 const task=aws(['ecs','describe-tasks','--cluster','tracepoint-staging','--tasks',taskArns[0]]).tasks[0];
 report.runningDigest=task.containers[0].imageDigest;report.imageMatches=task.containers[0].image.endsWith(':'+tag)&&report.expectedDigest===report.runningDigest;
 const target=service.loadBalancers[0].targetGroupArn;
 report.targets=aws(['elbv2','describe-target-health','--target-group-arn',target]).TargetHealthDescriptions.map(x=>x.TargetHealth.State);
 const alarms=aws(['cloudwatch','describe-alarms','--alarm-name-prefix','tracepoint-staging','--alarm-types','MetricAlarm','CompositeAlarm']);
 report.alarms=[...alarms.MetricAlarms,...alarms.CompositeAlarms].map(x=>({name:x.AlarmName,state:x.StateValue}));
 report.public=[];
 for(const route of ['/api/health','/login','/auth/confirm','/auth/callback','/equipment','/range-days','/firearms','/off-duty-firearms','/qualifications','/training','/fleet-management','/notifications']){
  const response=await fetch(base+route,{redirect:'manual',signal:AbortSignal.timeout(15000)});await response.body?.cancel();
  const location=response.headers.get('location');const passed=['/api/health','/login'].includes(route)?response.status===200:
   [302,303,307,308].includes(response.status)&&location&&new URL(location,base).origin===base&&new URL(location,base).pathname==='/login';
  report.public.push({route,status:response.status,passed:Boolean(passed)});
 }
 const definition=aws(['ecs','describe-task-definition','--task-definition',service.taskDefinition]).taskDefinition.containerDefinitions[0];
 const logOptions=definition.logConfiguration.options;
 const logStream=logOptions['awslogs-stream-prefix']+'/'+definition.name+'/'+task.taskArn.split('/').at(-1);
 const logs=aws(['logs','filter-log-events','--log-group-name',logOptions['awslogs-group'],'--log-stream-names',logStream,'--start-time',String(Math.floor(Date.parse(task.startedAt))),'--filter-pattern','?ERROR ?Error ?Unauthorized ?AccessDenied ?Exception']);
 report.logs={currentTaskOnly:true,matchingErrors:logs.events.length,filesystemPermissionErrors:logs.events.filter(x=>/EACCES/.test(x.message)).length};
 report.passed=report.stackStatus==='UPDATE_COMPLETE'&&report.ecs.desired===1&&report.ecs.running===1&&report.ecs.pending===0&&report.ecs.completed&&
  report.scan.status==='COMPLETE'&&Object.values(report.scan.findings).every(x=>x===0)&&report.imageMatches&&report.targets.length===1&&report.targets[0]==='healthy'&&
  report.alarms.length>=4&&report.alarms.every(x=>x.state==='OK')&&report.public.every(x=>x.passed)&&report.logs.matchingErrors===0;
 console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}catch {console.log(JSON.stringify({...report,passed:false,failure:'Evidence collection failed; credentials and log contents suppressed.'},null,2));process.exitCode=1;}

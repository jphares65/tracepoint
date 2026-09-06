import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {classifyStagingLogs} from './staging-log-classification.mjs';
const account='559054714699',region='us-east-1';
function aws(args){return JSON.parse(execFileSync(process.platform==='win32'?'aws.exe':'aws',[...args,'--region',region,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024,timeout:30000}));}
try {
 const identity=aws(['sts','get-caller-identity']);assert.equal(identity.Account,account);assert.match(identity.Arn,/^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);
 const arns=aws(['ecs','list-tasks','--cluster','tracepoint-staging','--service-name','tracepoint-staging','--desired-status','RUNNING']).taskArns;assert.equal(arns.length,1);
 const task=aws(['ecs','describe-tasks','--cluster','tracepoint-staging','--tasks',arns[0]]).tasks[0];
 const definition=aws(['ecs','describe-task-definition','--task-definition',task.taskDefinitionArn]).taskDefinition.containerDefinitions[0],options=definition.logConfiguration.options;
 assert.ok(options['awslogs-group'].startsWith('/tracepoint/staging/'));
 const stream=options['awslogs-stream-prefix']+'/'+definition.name+'/'+task.taskArn.split('/').at(-1),now=Date.now();
 const events=aws(['logs','filter-log-events','--log-group-name',options['awslogs-group'],'--log-stream-names',stream,'--start-time',String(Date.parse(task.startedAt)),'--filter-pattern','?ERROR ?Error ?Unauthorized ?AccessDenied ?Exception']).events;
 console.log(JSON.stringify({account,region,kind:'log-diagnostics',checkedAt:new Date(now).toISOString(),revision:Number(task.taskDefinitionArn.split(':').at(-1)),classification:classifyStagingLogs(events,now),messagesPrinted:false},null,2));
}catch{console.error('Staging log classification unavailable; raw logs and credentials suppressed.');process.exitCode=1;}

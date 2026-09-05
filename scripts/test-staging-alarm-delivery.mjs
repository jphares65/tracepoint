import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const account='559054714699',region='us-east-1';
const alarm='tracepoint-staging-runtime-alert';
const topic=`arn:aws:sns:${region}:${account}:tracepoint-staging-runtime-alerts`;
const queue=`https://sqs.${region}.amazonaws.com/${account}/tracepoint-staging-alert-receipts`;
export function matchesAlarmReceipt(body,run,state) {
 try {if(typeof body!=='string'||Buffer.byteLength(body)>262144)return false;const envelope=JSON.parse(body);const data=JSON.parse(envelope.Message);
  return envelope.TopicArn===topic&&data.AlarmName===alarm&&data.AWSAccountId===account&&data.NewStateValue===state&&data.NewStateReason===`TracePoint disposable alarm delivery ${run} ${state}`;
 } catch {return false;}
}
function aws(args){const raw=execFileSync('aws.exe',[...args,'--region',region,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,AWS_REGION:region,AWS_DEFAULT_REGION:region}});return raw.trim()?JSON.parse(raw):null;}
function gate(){const i=aws(['sts','get-caller-identity']);if(i.Account!==account||!i.Arn.includes('TracePointMigrationStaging'))throw Error('identity');}
function alarms(){return aws(['cloudwatch','describe-alarms','--alarm-name-prefix','tracepoint-staging','--alarm-types','MetricAlarm','CompositeAlarm']);}
async function receive(run,state){const until=Date.now()+60000;while(Date.now()<until){const result=aws(['sqs','receive-message','--queue-url',queue,'--max-number-of-messages','10','--wait-time-seconds','10','--visibility-timeout','120']);for(const message of result.Messages??[]){if(matchesAlarmReceipt(message.Body,run,state)){const {verifySnsNotification}=await import('../src/lib/email/sns-notification.ts');await verifySnsNotification(message.Body,topic);gate();aws(['sqs','delete-message','--queue-url',queue,'--receipt-handle',message.ReceiptHandle]);return true;}}}return false;}
async function main(){
 const run=randomUUID();let changed=false,incidentReceived=false,recoveryReceived=false;const started=Date.now();
 try {
  gate();const baseline=alarms();if(baseline.MetricAlarms.length<4||baseline.MetricAlarms.some(x=>x.StateValue!=='OK')||baseline.CompositeAlarms.find(x=>x.AlarmName===alarm)?.StateValue!=='OK')throw Error('baseline');
  const subscribers=aws(['sns','list-subscriptions-by-topic','--topic-arn',topic]);if(subscribers.NextToken||subscribers.Subscriptions.length!==1||subscribers.Subscriptions[0].Protocol!=='sqs'||subscribers.Subscriptions[0].Endpoint!==`arn:aws:sqs:${region}:${account}:tracepoint-staging-alert-receipts`)throw Error('unexpected recipient');
  if(!process.argv.includes('--execute')){console.log(JSON.stringify({preflight:'passed',mutations:0}));return;}
  gate();changed=true;aws(['cloudwatch','set-alarm-state','--alarm-name',alarm,'--state-value','ALARM','--state-reason',`TracePoint disposable alarm delivery ${run} ALARM`]);incidentReceived=await receive(run,'ALARM');
 } finally {
  if(changed){gate();const current=alarms();if(current.MetricAlarms.some(x=>x.StateValue!=='OK'))throw Error('Real underlying alarm changed; synthetic recovery refused');
   aws(['cloudwatch','set-alarm-state','--alarm-name',alarm,'--state-value','OK','--state-reason',`TracePoint disposable alarm delivery ${run} OK`]);recoveryReceived=await receive(run,'OK');
   const final=alarms();const healthy=[...final.MetricAlarms,...final.CompositeAlarms].every(x=>x.StateValue==='OK');const passed=incidentReceived&&recoveryReceived&&healthy;
   console.log(JSON.stringify({run,account,region,incidentReceived,recoveryReceived,allAlarmsOK:healthy,elapsedSeconds:(Date.now()-started)/1000,humanEscalation:'not tested; no human subscribers',passed}));if(!passed)process.exitCode=1;
  }
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Alarm delivery rehearsal failed; message bodies and credentials suppressed. Inspect alarm state before another rehearsal.');process.exitCode=1;});

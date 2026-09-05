import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createEmailProvider } from '../src/lib/email/provider-core.ts';
if (!process.argv.includes('--send-to-account-owner')) throw new Error('Explicit --send-to-account-owner is required for one transactional test.');
const env = {...process.env, AWS_REGION:'us-east-1', AWS_DEFAULT_REGION:'us-east-1'};
function aws(args) {
  try { return JSON.parse(execFileSync('aws.exe',[...args,'--region','us-east-1','--output','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']})); }
  catch { throw new Error('Staging metadata unavailable'); }
}
try {
  const identity=aws(['sts','get-caller-identity']);
  if(identity.Account!=='559054714699'||!identity.Arn.includes(':assumed-role/')||!identity.Arn.includes('TracePointMigrationStaging'))throw new Error('Identity mismatch');
  let secret;try{secret=JSON.parse(aws(['secretsmanager','get-secret-value','--secret-id','tracepoint/staging/application']).SecretString);}catch{throw new Error('Invalid staging secret');}
  if(secret.CONFIGURATION_ENVIRONMENT!=='staging'||secret.NEXT_PUBLIC_SUPABASE_URL!=='https://wztqqqashilusoppddxi.supabase.co'||secret.NEXT_PUBLIC_SITE_URL!=='https://staging.tracepointhq.com')throw new Error('Staging provider target mismatch');
  const service=aws(['ecs','describe-services','--cluster','tracepoint-staging','--services','tracepoint-staging']).services[0];
  const task=aws(['ecs','describe-task-definition','--task-definition',service.taskDefinition]).taskDefinition;
  const configuration=Object.fromEntries(task.containerDefinitions[0].environment.map(x=>[x.name,x.value]));
  if(configuration.TRACEPOINT_EMAIL_PROVIDER!=='brevo'||!configuration.TRACEPOINT_FROM_EMAIL)throw new Error('Live task lacks Brevo sender configuration');
  async function read(path) {
    const r=await fetch('https://api.brevo.com/v3'+path,{headers:{'api-key':secret.BREVO_API_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error('Brevo metadata rejected: HTTP '+r.status);
    return r.json();
  }
  const account=await read('/account');
  const senders=await read('/senders');
  if(!senders.senders?.some(s=>s.active&&s.email===configuration.TRACEPOINT_FROM_EMAIL))throw new Error('Live sender is not verified');
  if(typeof account.email!=='string'||!account.email.includes('@'))throw new Error('Account-owner recipient unavailable');
  const run=randomUUID();
  const provider=createEmailProvider({...secret,...configuration});
  const sent=await provider.send({to:[{email:account.email}],subject:'TracePoint AWS staging delivery check '+run,htmlContent:'<p>This is the authorized TracePoint AWS staging transactional delivery check. No customer data is included.</p>',textContent:'This is the authorized TracePoint AWS staging transactional delivery check. No customer data is included.'});
  if(!sent.messageId)throw new Error('No message ID; do not retry an ambiguous submission');
  console.log(JSON.stringify({run,messageId:sent.messageId,submitted:true,recipient:'verified Brevo account owner',taskRevision:task.revision}));
  const deadline=Date.now()+300000;
  while(Date.now()<deadline){
    const report=await read('/smtp/statistics/events?'+new URLSearchParams({messageId:sent.messageId,limit:'50',days:'1'}));
    const events=(report.events??[]).filter(e=>e.messageId===sent.messageId).map(e=>({event:e.event,date:e.date}));
    if(events.some(e=>e.event==='delivered')){console.log(JSON.stringify({run,messageId:sent.messageId,delivery:'verified',events}));process.exit(0);}
    if(events.some(e=>['hardBounce','softBounce','blocked','invalid','error'].includes(e.event)))throw new Error('Delivery failure reported; submission was not retried');
    console.log(JSON.stringify({run,delivery:'pending',events}));
    await new Promise(resolve=>setTimeout(resolve,15000));
  }
  throw new Error('Delivery not observed within five minutes; submission was not retried');
} catch { console.error('Staging delivery verification failed; sensitive details suppressed. Check prerequisites and the printed message ID before any retry.');process.exitCode=1; }

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const account='559054714699',region='us-east-1',origin='https://staging.tracepointhq.com';
const alb='arn:aws:elasticloadbalancing:us-east-1:559054714699:loadbalancer/app/tracep-Servi-G9c0RkjQMCj4/af079dabc04bbb9c';
export function validateRequestControlProof(proof){assert.equal(proof.account,account);assert.equal(proof.region,region);assert.equal(proof.origin,origin);assert.equal(proof.mode,'count');assert.equal(proof.loggingRedactionVerified,true);assert.equal(proof.probeAllowed,true);assert.ok(proof.countedRequests>0);assert.equal(proof.normalRoutesHealthy,true);const age=Date.now()-Date.parse(proof.completedAt);assert.ok(age>=0&&age<24*3600000);}
async function main(){
 assert.equal(process.argv[2],'--execute');assert.equal(process.argv[3],'--mode');const mode=process.argv[4];assert.ok(['logging','count','enforce'].includes(mode));assert.equal(process.argv.length,5);assert.equal(process.env.AWS_REGION,region);
 const env={...process.env,AWS_DEFAULT_REGION:region,AWS_CLI_OUTPUT_ENCODING:'UTF-8'};
 function aws(args){try{return JSON.parse(execFileSync('aws.exe',[...args,'--region',region,'--output','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024}));}catch{throw Error('Request-control AWS query failed; details suppressed');}}
 const id=aws(['sts','get-caller-identity']);assert.equal(id.Account,account);assert.match(id.Arn,/^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);
 const acl=aws(['wafv2','get-web-acl-for-resource','--resource-arn',alb]).WebACL;assert.equal(acl.Name,'tracepoint-staging-requests');assert.equal(acl.VisibilityConfig.SampledRequestsEnabled,false);
 if(mode==='logging')assert.equal(acl.Rules.length,0);else{assert.equal(acl.Rules.length,2);assert.ok(acl.Rules.every(r=>mode==='count'?Boolean(r.Action.Count):r.Action.Block?.CustomResponse?.ResponseCode===429));}
 const configuration=aws(['wafv2','get-logging-configuration','--resource-arn',acl.ARN]).LoggingConfiguration;
 for(const name of ['authorization','cookie','referer','x-api-key'])assert.ok(configuration.RedactedFields.some(f=>f.SingleHeader?.Name===name));assert.ok(configuration.RedactedFields.some(f=>f.QueryString));assert.ok(configuration.RedactedFields.some(f=>f.UriPath));
 const started=Date.now();const proof={account,region,origin,mode,webAclArn:acl.ARN,startedAt:new Date(started).toISOString()};
 async function normal(){for(const route of ['/api/health','/login'])assert.equal((await fetch(origin+route,{redirect:'manual'})).status,200);const r=await fetch(origin+'/equipment',{redirect:'manual'});assert.equal(r.status,307);assert.equal(new URL(r.headers.get('location'),origin).pathname,'/login');}
 await normal();let blocked=0,allowed=0;const latency=[];
 const limit=mode==='logging'?1:120;
 for(let i=0;i<limit;i++){
  const begin=Date.now();const r=await fetch(origin+'/api/health?tracepoint_rate_probe=rehearsal',{headers:{authorization:'Bearer synthetic-redaction-probe',cookie:'synthetic_probe=redact-me',referer:origin+'/synthetic?redact-me=1','x-api-key':'synthetic-redaction-probe'},redirect:'manual'});latency.push(Date.now()-begin);
  if(r.status===429){assert.equal(mode,'enforce');assert.equal(r.headers.get('retry-after'),'60');blocked++;break;}assert.equal(r.status,200);allowed++;
  if(mode!=='logging')await new Promise(resolve=>setTimeout(resolve,1000));
 }
 if(mode==='enforce'){
  assert.ok(blocked>0,'No live rate-limit enforcement observed');
  const recoveryStart=Date.now();let recovered=false;
  // WAF rate estimates refresh asynchronously; allow a bounded quiet window.
  while(Date.now()-recoveryStart<180000){await new Promise(resolve=>setTimeout(resolve,30000));const response=await fetch(origin+'/api/health?tracepoint_rate_probe=rehearsal',{redirect:'manual'});if(response.status===200){recovered=true;break;}assert.equal(response.status,429);}
  assert.ok(recovered,'Synthetic rate-limit did not recover after quiet window');proof.rateLimitRecoveryMilliseconds=Date.now()-recoveryStart;
 }
 await normal();proof.normalRoutesHealthy=true;proof.allowed=allowed;proof.blocked=blocked;proof.probeAllowed=blocked===0;proof.probeLatencyP95Ms=[...latency].sort((a,b)=>a-b)[Math.ceil(latency.length*.95)-1];
 const deadline=Date.now()+6*60000;let records=[];
 while(Date.now()<deadline){
  records=aws(['logs','filter-log-events','--log-group-name','aws-waf-logs-tracepoint-staging-requests','--start-time',String(started),'--limit','1000']).events.map(e=>{try{return JSON.parse(e.message);}catch{return null;}}).filter(Boolean);
  const marked=records.filter(r=>r.httpRequest?.headers?.some(h=>h.name.toLowerCase()==='x-api-key'&&h.value==='REDACTED'));
  if(marked.length){for(const record of marked){assert.equal(record.httpRequest.uri,'REDACTED');assert.equal(record.httpRequest.args,'REDACTED');for(const h of record.httpRequest.headers)if(['authorization','cookie','referer','x-api-key'].includes(h.name.toLowerCase()))assert.equal(h.value,'REDACTED');}proof.loggingRedactionVerified=true;break;}
  await new Promise(resolve=>setTimeout(resolve,15000));
 }
 assert.equal(proof.loggingRedactionVerified,true,'Redacted WAF log delivery not observed');
 if(mode==='count'){
  const metricDeadline=Date.now()+3*60000;
  do{const result=aws(['cloudwatch','get-metric-statistics','--namespace','AWS/WAFV2','--metric-name','CountedRequests','--dimensions','Name=WebACL,Value=tracepoint-staging-requests','Name=Rule,Value=SyntheticRateProbe','Name=Region,Value=us-east-1','--start-time',new Date(started-60000).toISOString(),'--end-time',new Date().toISOString(),'--period','60','--statistics','Sum']);proof.countedRequests=result.Datapoints.reduce((sum,p)=>sum+p.Sum,0);if(proof.countedRequests>0)break;await new Promise(resolve=>setTimeout(resolve,15000));}while(Date.now()<metricDeadline);
  assert.ok(proof.countedRequests>0,'Count-mode threshold has not been observed');
  const global=aws(['cloudwatch','get-metric-statistics','--namespace','AWS/WAFV2','--metric-name','CountedRequests','--dimensions','Name=WebACL,Value=tracepoint-staging-requests','Name=Rule,Value=RequestFlood','Name=Region,Value=us-east-1','--start-time',new Date(started-60000).toISOString(),'--end-time',new Date().toISOString(),'--period','60','--statistics','Sum']);proof.globalRateMatches=global.Datapoints.reduce((sum,p)=>sum+p.Sum,0);assert.equal(proof.globalRateMatches,0,'Global threshold caught legitimate rehearsal traffic');
 }
 proof.completedAt=new Date().toISOString();if(mode==='count')validateRequestControlProof(proof);
 await writeFile('docs/aws-request-controls-'+mode+'-20260905.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({requestControls:'FAILED',errorName:error.name}));process.exitCode=1;});

import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const repository='jphares65/tracepoint',branch='codex/aws-staging-readiness-20260902';
try {
 const sha=process.argv[2];assert.match(sha??'',/^[0-9a-f]{40}$/);
 const git=args=>execFileSync('git',['-c','safe.directory='+process.cwd(),...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 assert.match(git(['remote','get-url','origin']),/^https:\/\/github\.com\/jphares65\/tracepoint(?:\.git)?$/);
 const credential=execFileSync('git',['-c','safe.directory='+process.cwd(),'credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
 const token=credential.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);assert.ok(token);
 async function get(path){const response=await fetch('https://api.github.com/repos/'+repository+path,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);return response.json();}
 const runs=await get('/actions/workflows/aws-staging-runtime.yml/runs?'+new URLSearchParams({branch,head_sha:sha,per_page:'20'}));
 const run=runs.workflow_runs.find(x=>x.head_sha===sha&&x.head_branch===branch);
 const preview=(await get('/commits/'+sha+'/status')).statuses.find(x=>x.context==='Vercel');
 if(!run){console.log(JSON.stringify({commit:sha,workflowFound:false,preview:preview?.state??'pending'}));}
 else {
  const jobs=await get('/actions/runs/'+run.id+'/jobs?per_page=100');
  console.log(JSON.stringify({commit:sha,workflowFound:true,run:run.id,attempt:run.run_attempt,status:run.status,conclusion:run.conclusion,url:run.html_url,preview:preview?.state??'pending',checkedAtUTC:new Date().toISOString(),jobs:jobs.jobs.map(job=>({id:job.id,name:job.name,status:job.status,conclusion:job.conclusion,steps:job.steps.map(step=>({name:step.name,status:step.status,conclusion:step.conclusion}))}))},null,2));
 }
} catch {console.error('Staging workflow evidence unavailable; credentials and response details suppressed.');process.exitCode=1;}

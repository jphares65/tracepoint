import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
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
  const report={commit:sha,workflowFound:true,run:run.id,attempt:run.run_attempt,status:run.status,conclusion:run.conclusion,url:run.html_url,preview:preview?.state??'pending',checkedAtUTC:new Date().toISOString(),jobs:jobs.jobs.map(job=>({id:job.id,name:job.name,status:job.status,conclusion:job.conclusion,steps:job.steps.map(step=>({name:step.name,status:step.status,conclusion:step.conclusion}))}))};
  if(process.argv.includes('--completed-logs')){
   assert.equal(run.status,'completed');report.execution=[];
   for(const job of jobs.jobs){
    let response=await fetch('https://api.github.com/repos/'+repository+'/actions/jobs/'+job.id+'/logs',{headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(20000)});
    if(response.status===302){const url=new URL(response.headers.get('location'));assert.equal(url.protocol,'https:');assert.ok(url.hostname.endsWith('.blob.core.windows.net')||url.hostname.endsWith('.actions.githubusercontent.com'));response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});}
    assert.equal(response.status,200);const logs=(await response.text()).split(/\r?\n/).map(line=>line.replace(/^\d{4}-\d\d-\d\dT\S+\s*/,'').replace(/\x1b\[[0-9;]*m/g,'')).join('\n');
    const evidence={job:job.name,testCounts:[...logs.matchAll(/(?:#|\u2139) tests (\d+)/g)].map(x=>Number(x[1])),fixtures:[],structuralGates:[],resourceDiff:[...new Set(logs.match(/\[(?:~|\+|-)\] AWS::[A-Za-z0-9:]+[^\r\n]*/g)??[])]};
    for(const line of logs.split('\n')){try{const value=JSON.parse(line.trim());if(value.fixtureRun){const item={run:value.fixtureRun};for(const key of ['cleanup','storageCleanup','auditCreation','custodyHistory','documentAudit'])if(value[key]!==undefined)item[key]=value[key];if(Object.keys(item).length>1)evidence.fixtures.push(item);}if(value.safe===true&&typeof value.scope==='string')evidence.structuralGates.push({safe:true,scope:value.scope});}catch{}}
    const rollback=logs.match(/\{\s*"currentTaskDefinition"\s*:[\s\S]*?\n\}/);
    if(rollback){const value=JSON.parse(rollback[0]);evidence.rollback={};for(const key of ['currentTaskDefinition','priorTaskDefinition','imageTag','rollbackVerified','rollbackSeconds','returnSeconds','correctedRuntimeRestored'])evidence.rollback[key]=value[key];}
    report.execution.push(evidence);
   }
  }
  if(process.argv.includes('--save'))writeFileSync('docs/aws-workflow-'+sha+'.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
 }
} catch {console.error('Staging workflow evidence unavailable; credentials and response details suppressed.');process.exitCode=1;}

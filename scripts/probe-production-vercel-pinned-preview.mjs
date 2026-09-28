#!/usr/bin/env node
// Fresh pinned-code deployment to Preview only. The Preview Supabase URL must
// resolve to the isolated staging project before the POST is permitted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { VERCEL_PROJECT_ID, VERCEL_TOKEN_SECRET, BASELINE_GIT_SHA,
  attestVercelProject, withExactVercelTeam } from './production-vercel-rollback-core.mjs';
assert.ok(JSON.stringify(process.argv.slice(2))==='["--profile=tracepoint-production"]'||
  JSON.stringify(process.argv.slice(2))==='["--profile=tracepoint-production","--inspect"]');
const aws=spawnSync(process.platform==='win32'?'aws.exe':'aws',
  ['secretsmanager','get-secret-value','--secret-id',VERCEL_TOKEN_SECRET,'--query','SecretString',
    '--profile','tracepoint-production','--region','us-east-1','--output','text'],
  {encoding:'utf8',maxBuffer:1024*1024});
assert.equal(aws.status,0,'TOKEN_UNAVAILABLE');
const raw=aws.stdout.trim();
const wrapped=raw.startsWith('{')?JSON.parse(raw):null;
if(wrapped) assert.deepEqual(Object.keys(wrapped),[VERCEL_TOKEN_SECRET]);
const token=wrapped?wrapped[VERCEL_TOKEN_SECRET]:raw;
assert.ok(typeof token==='string'&&token.length>=32);
async function call(method,path,body){
  const response=await fetch(`https://api.vercel.com${withExactVercelTeam(path)}`,
    {method,headers:{authorization:`Bearer ${token}`,accept:'application/json',
      ...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
  let data=null; try{data=await response.json();}catch{}
  return {status:response.status,data};
}
let stage='project';
let safeDetail=null;
try{
  const project=await call('GET',`/v9/projects/${VERCEL_PROJECT_ID}`);
  assert.equal(project.status,200); attestVercelProject(project.data);
  stage='preview-source';
  const env=await call('GET',`/v9/projects/${VERCEL_PROJECT_ID}/env`);
  assert.equal(env.status,200);
  const urls=(env.data.envs??env.data).filter(x=>x.key==='NEXT_PUBLIC_SUPABASE_URL'&&x.target?.includes('preview'));
  assert.equal(urls.length,1);
  const detail=await call('GET',`/v1/projects/${VERCEL_PROJECT_ID}/env/${urls[0].id}`);
  assert.equal(detail.status,200);
  assert.equal(detail.data.id,urls[0].id);
  assert.equal(new URL(detail.data.value).hostname,'wztqqqashilusoppddxi.supabase.co',
    'PREVIEW_SOURCE_NOT_STAGING');
  if(process.argv[3]==='--inspect'){
    const listing=await call('GET',`/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=10`);
    assert.equal(listing.status,200);
    console.log(JSON.stringify({status:'PINNED_PREVIEW_INSPECTION',deployments:(listing.data.deployments??[])
      .slice(0,10).map(x=>({uid:x.uid??x.id,target:x.target??null,readyState:x.readyState,
        gitSha:x.meta?.githubCommitSha??null}))}));
    process.exit(0);
  }
  stage='create-preview';
  const created=await call('POST','/v13/deployments?forceNew=1',{
    name:'tracepoint',project:VERCEL_PROJECT_ID,
    gitSource:{type:'github',repoId:Number(project.data.link.repoId),
      repo:'jphares65/tracepoint',ref:BASELINE_GIT_SHA},
  });
  safeDetail={httpStatus:created.status,errorCode:/^[A-Za-z0-9_-]{1,64}$/.test(created.data?.error?.code??'')
    ?created.data.error.code:null,uidPresent:typeof(created.data?.uid??created.data?.id)==='string',
    target:created.data?.target??null,
    errorMessage:typeof created.data?.error?.message==='string'
      ?created.data.error.message.slice(0,500).replace(/https?:\/\/\S+/g,'[url]')
        .replace(/\b[A-Za-z0-9_-]{24,}\b/g,'[token]'):null};
  assert.equal(created.status,200,`PREVIEW_DEPLOY_HTTP_${created.status}`);
  const uid=created.data.uid??created.data.id;
  assert.match(uid??'',/^dpl_[A-Za-z0-9]+$/);
  assert.equal(created.data.projectId,VERCEL_PROJECT_ID);
  assert.ok(created.data.target==null,'PRODUCTION_TARGET_FORBIDDEN');
  stage='poll';
  let state=null;
  for(let i=0;i<30;i++){
    const current=await call('GET',`/v13/deployments/${uid}`);
    assert.equal(current.status,200);
    assert.equal(current.data.projectId,VERCEL_PROJECT_ID);
    assert.ok(current.data.target==null,'PRODUCTION_TARGET_FORBIDDEN');
    assert.equal(current.data.meta?.githubCommitSha,BASELINE_GIT_SHA,'GIT_SHA_MISMATCH');
    state=current.data.readyState;
    if(['READY','ERROR','CANCELED'].includes(state))break;
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  assert.equal(state,'READY',`PREVIEW_NOT_READY_${state??'UNKNOWN'}`);
  console.log(JSON.stringify({status:'PINNED_PREVIEW_DEPLOYMENT_PASS',projectId:VERCEL_PROJECT_ID,
    deploymentUid:uid,gitSha:BASELINE_GIT_SHA,previewSource:'wztqqqashilusoppddxi',
    productionAuthorityChanged:false,tokenLogged:false}));
}catch(error){
  console.error(JSON.stringify({status:'PINNED_PREVIEW_DEPLOYMENT_BLOCKED',stage,
    code:/^[A-Z0-9_:]+$/.test(error?.message??'')?error.message:'PROBE_FAILED',safeDetail}));
  process.exitCode=2;
}

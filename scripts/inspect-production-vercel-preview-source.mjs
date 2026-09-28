#!/usr/bin/env node
// Read only non-secret Vercel Preview URL metadata; never print env values.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { VERCEL_PROJECT_ID, VERCEL_TOKEN_SECRET,
  withExactVercelTeam } from './production-vercel-rollback-core.mjs';
assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production']);
const got = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
  ['secretsmanager','get-secret-value','--secret-id',VERCEL_TOKEN_SECRET,'--query','SecretString',
    '--profile','tracepoint-production','--region','us-east-1','--output','text'],
  { encoding:'utf8', maxBuffer:1024*1024 });
assert.equal(got.status,0,'TOKEN_UNAVAILABLE');
const payload=got.stdout.trim();
const parsed=payload.startsWith('{')?JSON.parse(payload):null;
if(parsed) assert.deepEqual(Object.keys(parsed),[VERCEL_TOKEN_SECRET]);
const token=parsed?parsed[VERCEL_TOKEN_SECRET]:payload;
assert.ok(typeof token==='string' && token.length>=32);
const url=`https://api.vercel.com${withExactVercelTeam(`/v9/projects/${VERCEL_PROJECT_ID}/env`)}`;
const response=await fetch(url,{headers:{authorization:`Bearer ${token}`,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
assert.equal(response.status,200,'VERCEL_ENV_READ_FAILED');
const data=await response.json();
const vars=data.envs??data;
assert.ok(Array.isArray(vars));
const urls=vars.filter(entry=>entry.key==='NEXT_PUBLIC_SUPABASE_URL' && entry.target?.includes('preview'));
assert.equal(urls.length,1,'PREVIEW_SOURCE_AMBIGUOUS');
const detailUrl=`https://api.vercel.com${withExactVercelTeam(`/v1/projects/${VERCEL_PROJECT_ID}/env/${urls[0].id}`)}`;
const detailResponse=await fetch(detailUrl,{headers:{authorization:`Bearer ${token}`,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
const detail=detailResponse.status===200?await detailResponse.json():null;
assert.equal(detail?.id,urls[0].id,'PREVIEW_VARIABLE_ID_MISMATCH');
assert.equal(detail?.key,'NEXT_PUBLIC_SUPABASE_URL','PREVIEW_VARIABLE_KEY_MISMATCH');
let ref=null;
try { const parsedUrl=new URL(detail.value); ref=/^([a-z0-9]+)\.supabase\.co$/.exec(parsedUrl.hostname)?.[1]??null; } catch { /* fail closed */ }
console.log(JSON.stringify({status:ref==='wztqqqashilusoppddxi'?'PREVIEW_SOURCE_STAGING_ATTESTED':'PREVIEW_SOURCE_UNVERIFIED',
  projectId:VERCEL_PROJECT_ID,previewSourceRef:ref,previewVariableId:urls[0].id,
  previewVariableType:urls[0].type,detailStatus:detailResponse.status,valuesLogged:false}));
if(ref!=='wztqqqashilusoppddxi') process.exitCode=2;

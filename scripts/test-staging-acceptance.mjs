import {exerciseExtendedWorkflows} from './staging-extended-workflows.mjs';
import {exerciseRangeDocuments} from './staging-range-document-scenarios.mjs';
import {runBoundedProbe} from './staging-resilience-core.mjs';
﻿import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
const baseURL = 'https://staging.tracepointhq.com';
const routes = ['/', '/landing', '/equipment', '/range-days', '/firearms', '/off-duty-firearms', '/qualifications', '/training', '/training/certifications', '/fleet-management', '/notifications', '/settings/import-export', '/settings/import-export/ai-importer'];
const results = [];
let acceptanceStep;
let authenticationResponse;
let authenticationPage;
let acceptanceDetail;
const totpCounters=new Map();
function currentTotp(secret) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';
  for(const char of secret.replace(/=+$/,'')){const value=alphabet.indexOf(char);assert.ok(value>=0);bits+=value.toString(2).padStart(5,'0');}
  const key=Buffer.from((bits.match(/.{8}/g)??[]).map(value=>parseInt(value,2)));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac('sha1',key).update(counter).digest(),offset=digest[19]&15;
  return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
async function signIn(page,email,password,totpSecret){
  acceptanceStep='login-page';
  await page.goto('/login');
  const native=page.getByRole('button',{name:'Continue with secure sign-in',exact:true});
  if(await native.count()){
    acceptanceStep='cognito-redirect';
    assert.ok(totpSecret,'A staging-only TOTP secret is required for Cognito acceptance.');
    const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/cognito/login'&&response.request().method()==='POST');
    await native.click();
    const response=await responsePromise;
    authenticationResponse={status:response.status()};
    if(response.status()!==303){try{authenticationResponse.code=(await response.json()).code;}catch{}throw new Error('Cognito authorization did not start.');}
    try {
      acceptanceStep='cognito-login-form';
      await page.locator('input[name="username"]:visible').first().fill(email);
      await page.locator('input[name="password"]:visible').first().fill(password);
    await page.locator('input[name="password"]:visible').first().press('Enter');
    }catch(error){
      const location=new URL(page.url());
      authenticationPage={origin:location.origin,path:location.pathname,visibleInputs:await page.locator('input:visible').evaluateAll(inputs=>inputs.slice(0,8).map(input=>({name:input.getAttribute('name'),type:input.getAttribute('type')})))};
      throw error;
    }
    acceptanceStep='cognito-mfa-challenge';
    const code=page.locator('input:visible[name*="code" i]').first();
    await code.waitFor();
    let counter=Math.floor(Date.now()/30000),remaining=30000-Date.now()%30000;
    if(remaining<5000||totpCounters.get(email)===counter){await page.waitForTimeout(remaining+500);counter=Math.floor(Date.now()/30000);}
    totpCounters.set(email,counter);
    await code.fill(currentTotp(totpSecret));
    await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  }else{
    await page.getByLabel('Email',{exact:true}).fill(email);
    await page.getByLabel('Password',{exact:true}).fill(password);
    await page.locator('button[type="submit"]').click();
  }
  acceptanceStep='cognito-callback';
  try{await page.waitForURL(url=>url.origin===baseURL&&url.pathname!=='/login');}
  catch(error){const location=new URL(page.url());authenticationPage={origin:location.origin,path:location.pathname};throw error;}
}
async function check(name, work) {
  acceptanceStep=undefined;
  acceptanceDetail=undefined;
  try { await work(); results.push({ name, status: 'pass' }); }
  catch (error) { results.push({ name, status: 'fail', diagnostic: error?.code === 'ERR_ASSERTION' ? { code: error.code, actual: typeof error.actual === 'number' ? error.actual : undefined, expected: typeof error.expected === 'number' ? error.expected : undefined, step:acceptanceStep,detail:acceptanceDetail } : { code: error?.name === 'TimeoutError' ? 'BROWSER_TIMEOUT' : /strict mode violation/.test(error?.message ?? '') ? 'LOCATOR_AMBIGUOUS' : 'REQUEST_OR_BROWSER_FAILURE', step: acceptanceStep,detail:acceptanceDetail } }); }
}
function safeAcceptanceDetail(value){const text=typeof value==='string'?value:'';return /^(Import reference data|Migration workspace|The validated migration plan|PostgreSQL data operation|Fleet V1|The audit record|Off-duty request|This TracePoint module)/.test(text)?text.slice(0,160):undefined;}
for (const path of ['/login', '/api/health', '/auth/confirm', '/auth/callback', ...routes, '/api/equipment/types']) await check(`anonymous ${path}`, async () => {
  const r = await fetch(baseURL + path, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (['/login','/api/health','/landing'].includes(path)) assert.equal(r.status, 200);
  else if(path.startsWith('/api/')) {
    if(r.status!==401){assert.ok([302,303,307,308].includes(r.status));assert.equal(new URL(r.headers.get('location'),baseURL).pathname,'/login');}
  }
  else {
    assert.ok([302,303,307,308].includes(r.status));
    const target = new URL(r.headers.get('location'), baseURL);
    assert.equal(target.origin, baseURL); assert.equal(target.pathname, path === '/' ? '/landing' : '/login');
  }
});
await check('browser login form renders',async()=>{
  const publicBrowser=await chromium.launch({headless:true});
  try {
    const page=await publicBrowser.newPage();
    const response=await page.goto(baseURL+'/login');assert.equal(response.status(),200);
    const native=page.getByRole('button',{name:'Continue with secure sign-in',exact:true});
    if(await native.count()) assert.equal(await native.isVisible(),true);
    else {
      assert.equal(await page.getByLabel('Email',{exact:true}).isVisible(),true);
      assert.equal(await page.getByLabel('Password',{exact:true}).isVisible(),true);
      assert.equal(await page.locator('button[type="submit"]').isVisible(),true);
    }
  }finally{await publicBrowser.close();}
});
const email = process.env.TRACEPOINT_ACCEPTANCE_EMAIL;
const password = process.env.TRACEPOINT_ACCEPTANCE_PASSWORD;
const department = process.env.TRACEPOINT_ACCEPTANCE_DEPARTMENT_ID;
let browser;
if (!email || !password || !department) results.push({ name: 'authenticated workflows', status: 'blocked', reason: 'Requires staging-only email/password and disposable department ID in environment variables' });
else try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL });
  // No screenshots, traces, cookies, passwords or response bodies are persisted.
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    return origin===baseURL||origin.endsWith('.amazoncognito.com') ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await signIn(page,email,password,process.env.TRACEPOINT_ACCEPTANCE_MANAGER_TOTP_SECRET);
  const access = await context.request.get('/api/access');
  assert.equal(access.status(), 200);
  assert.equal((await access.json()).access.departmentId, department);
  results.push({ name: 'password login and tenant resolution', status: 'pass' });
  for (const path of routes) await check(`authenticated page ${path}`, async () => {
    const r = await page.goto(path); assert.equal(r.status(),200);
    assert.equal(new URL(page.url()).pathname,path);
  });
  await check('session persistence', async () => {
    await page.reload(); assert.equal((await context.request.get('/api/access')).status(),200);
  });
  for (const path of ['/api/equipment/assets','/api/equipment/types','/api/equipment/requirements','/api/settings/current-rules','/api/qualifications','/api/training/certification-types','/api/agency-training/courses']) await check(`JSON ${path}`, async () => {
    const r=await context.request.get(path); assert.equal(r.status(),200); assert.match(r.headers()['content-type'],/application\/json/);
  });
  await check('AI importer workspace preview, approved execution and persistence',async()=>{
    const run=crypto.randomUUID(),unit=`AI-${run.slice(0,8).toUpperCase()}`;let workspaceId;
    try {
      acceptanceStep='importer-workspace-create';
      const created=await page.evaluate(async({run,unit})=>{const form=new FormData();form.append('files',new File([`unit number,year,make,model,status,comments\n${unit},2026,Synthetic,Importer,Available,acceptance ${run}\n`],`aws-native-${run}.csv`,{type:'text/csv'}));const response=await fetch('/api/settings/ai-importer/workspaces',{method:'POST',body:form});return {status:response.status,body:await response.json()};},{run,unit});
      assert.equal(created.status,201);workspaceId=created.body.workspace.id;assert.match(workspaceId,/^[0-9a-f-]{36}$/i);
      acceptanceStep='importer-preview';
      const preview=await context.request.post(`/api/settings/ai-importer/workspaces/${workspaceId}/preview`);const plan=await preview.json();acceptanceDetail=safeAcceptanceDetail(plan.error);assert.equal(preview.status(),200);assert.ok(plan.readyDomains.includes('vehicles'));
      acceptanceStep='importer-execute';
      const executed=await context.request.post(`/api/settings/ai-importer/workspaces/${workspaceId}/execute`,{data:{domains:['vehicles'],approval:{domain:true,mappings:true,validation:true,finalAction:true},approvalToken:plan.approvalToken,workspaceDigest:plan.workspaceDigest}});const outcome=await executed.json();assert.equal(executed.status(),200);assert.equal(outcome.results.vehicles.created,1);
      acceptanceStep='importer-persistence';
      const fleet=await context.request.get('/api/fleet/vehicles');assert.equal(fleet.status(),200);assert.ok((await fleet.json()).items.some(vehicle=>vehicle.unit_number===unit));
    } finally {if(workspaceId){const removed=await context.request.delete(`/api/settings/ai-importer/workspaces/${workspaceId}`);if(removed.status()!==200){acceptanceStep='importer-cleanup';assert.equal(removed.status(),200);}}}
  });
  const foreign = process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_DEPARTMENT_ID;
  if (foreign && foreign !== department) await check('foreign tenant cookie rejection', async () => {
    await context.addCookies([{name:'tracepoint_department_id',value:foreign,url:baseURL}]);
    try {
      const r=await context.request.get('/api/access');
      if(r.status()===200) assert.equal((await r.json()).access.departmentId,department);
      else assert.ok([401,403].includes(r.status()));
    } finally {await context.clearCookies({name:'tracepoint_department_id'});}
  });
  else results.push({name:'foreign tenant negative test',status:'blocked',reason:'Requires second disposable staging department ID'});
  if (process.env.TRACEPOINT_ACCEPTANCE_WRITES === 'disposable-staging') await check('type Add/Edit/Archive/Restore/Remove',async()=>{
    let id; const name=`acceptance-${crypto.randomUUID()}`;
    try {
      const r=await context.request.post('/api/equipment/types',{data:{name,category:'Acceptance'}});
      assert.equal(r.status(),201); const item=(await r.json()).item; id=item.id;
      assert.equal(item.department_id,department);
      for(const isActive of [true,false,true]) {
        const updated=await context.request.patch('/api/equipment/types',{data:{id,name:name+'-edited',category:'Acceptance',isActive}});
        assert.equal(updated.status(),200);const item=(await updated.json()).item;
        assert.equal(item.name,name+'-edited');assert.equal(item.is_active,isActive);
      }
    } finally {
      if(id) {const r=await context.request.delete('/api/equipment/types',{data:{id}});assert.equal(r.status(),200,'Cleanup failed');}
    }
  });
  else results.push({name:'disposable type lifecycle',status:'blocked',reason:'Requires TRACEPOINT_ACCEPTANCE_WRITES=disposable-staging'});
  if(process.env.TRACEPOINT_ACCEPTANCE_OFFICER_ID) await check('equipment custody, Officer view and role enforcement',async()=>{
    const managerId=process.env.TRACEPOINT_ACCEPTANCE_MANAGER_ID;
    const officerId=process.env.TRACEPOINT_ACCEPTANCE_OFFICER_ID;
    const foreignUserId=process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_USER_ID;
    const name='acceptance-custody-'+crypto.randomUUID();
    acceptanceStep='create-custody-type';
    const createdType=await context.request.post('/api/equipment/types',{data:{name}});
    assert.equal(createdType.status(),201);const typeId=(await createdType.json()).item.id;
    acceptanceStep='create-custody-asset';
    const created=await context.request.post('/api/equipment/assets',{data:{equipmentTypeId:typeId,assignedUserId:managerId,assetNumber:name}});
    assert.equal(created.status(),201);const assetId=(await created.json()).item.id;
    for(const assignedUserId of [managerId,officerId,null]){
      acceptanceStep='update-custody';
      const updated=await context.request.patch('/api/equipment/assets',{data:{id:assetId,assignedUserId}});
      assert.equal(updated.status(),200);assert.equal((await updated.json()).item.assigned_user_id,assignedUserId);
      const directory=await context.request.get('/api/equipment/assets');assert.equal(directory.status(),200);
      assert.equal((await directory.json()).items.find(x=>x.id===assetId).assigned_user_id,assignedUserId);
      if(assignedUserId){
        acceptanceStep='Officer-Readiness-view';
        await page.goto('/equipment');await page.getByRole('button',{name:'Officer Readiness',exact:true}).click();
        await page.getByText(name,{exact:true}).waitFor({state:'visible'});
      }
    }
    acceptanceStep='foreign-assignment-denial';
    const denied=await context.request.patch('/api/equipment/assets',{data:{id:assetId,assignedUserId:foreignUserId}});
    assert.equal(denied.status(),400);
    const unauthorized=await browser.newContext({baseURL});
    try {
      acceptanceStep='non-manager-login';
      const officerPage=await unauthorized.newPage();
      await signIn(officerPage,process.env.TRACEPOINT_ACCEPTANCE_OFFICER_EMAIL,process.env.TRACEPOINT_ACCEPTANCE_OFFICER_PASSWORD,process.env.TRACEPOINT_ACCEPTANCE_OFFICER_TOTP_SECRET);
      acceptanceStep='non-manager-write-denial';
      const write=await unauthorized.request.post('/api/equipment/types',{data:{name:'forbidden-'+name}});assert.equal(write.status(),403);
      const edit=await unauthorized.request.patch('/api/equipment/assets',{data:{id:assetId,assignedUserId:officerId}});assert.equal(edit.status(),403);
      const listing=await unauthorized.request.get('/api/equipment/assets');assert.equal(listing.status(),200);assert.equal((await listing.json()).items.some(x=>x.id===assetId),false);
    } finally {await unauthorized.close();}
    // Parent runner removes and verifies custody history, assets and types.
  });
  if(process.env.TRACEPOINT_ACCEPTANCE_STORAGE_PROVIDER==='s3')await check('private department patch upload, delivery and cross-tenant denial',async()=>{
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
    const upload=await context.request.post('/api/settings/department-patch',{multipart:{file:{name:'acceptance.png',mimeType:'image/png',buffer:bytes}}});assert.equal(upload.status(),200);
    const patch=(await upload.json()).patchUrl;assert.ok(patch.startsWith('/api/settings/department-patch?path='));
    const delivery=await context.request.get(patch,{maxRedirects:0});assert.equal(delivery.status(),307);
    const location=new URL(delivery.headers().location);assert.equal(location.protocol,'https:');assert.equal(location.hostname,'tracepoint-staging-private-559054714699.s3.us-east-1.amazonaws.com');
    const downloaded=await fetch(location,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
    const anonymous=await fetch(baseURL+patch,{redirect:'manual',signal:AbortSignal.timeout(15000)});if(anonymous.status!==401){assert.ok([302,303,307,308].includes(anonymous.status));assert.equal(new URL(anonymous.headers.get('location'),baseURL).pathname,'/login');}
    const foreignContext=await browser.newContext({baseURL});
    try{
      const foreignPage=await foreignContext.newPage();await signIn(foreignPage,process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_EMAIL,process.env.TRACEPOINT_ACCEPTANCE_OFFICER_PASSWORD,process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_TOTP_SECRET);
      assert.equal((await foreignContext.request.get(patch,{maxRedirects:0})).status(),404);
      const denied=await foreignContext.request.post('/api/settings/department-patch',{multipart:{file:{name:'acceptance.png',mimeType:'image/png',buffer:bytes}}});assert.equal(denied.status(),403);
    }finally{await foreignContext.close();}
  });
  if(process.env.TRACEPOINT_ACCEPTANCE_RANGE_DOCUMENTS==='enabled')await exerciseRangeDocuments({context,browser,baseURL,department,check,signIn});
  if(process.env.TRACEPOINT_ACCEPTANCE_EXTENDED_WORKFLOWS==='enabled')await exerciseExtendedWorkflows({context,browser,baseURL,check,signIn});
  if(process.env.TRACEPOINT_ACCEPTANCE_EXTENDED_WORKFLOWS==='enabled')await check('bounded authenticated read concurrency',async()=>{
    const probe=await runBoundedProbe({concurrency:4,requestsPerWorker:5,maxP95Milliseconds:5000,request:()=>context.request.get('/api/access',{timeout:10000}),verify:async r=>{assert.equal(r.status(),200);assert.equal((await r.json()).access.departmentId,department);}});
    console.log(JSON.stringify({authenticatedReadProbe:{...probe,allTenantChecksPassed:true,productionCapacityProof:false}}));
  });
  await check('logout',async()=>{
    const logout=await context.request.post('/api/auth/cognito/logout',{headers:{Origin:baseURL,'Sec-Fetch-Site':'same-origin'},maxRedirects:0});assert.equal(logout.status(),303);assert.equal(new URL(logout.headers().location,baseURL).origin,'https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com');
    const r=await context.request.get('/equipment',{maxRedirects:0});assert.ok([302,303,307,308].includes(r.status()));
    assert.equal(new URL(r.headers().location,baseURL).pathname,'/login');
  });
} catch (error) {results.push({name:'authenticated setup',status:'fail',diagnostic:{code:error?.name==='TimeoutError'?'BROWSER_TIMEOUT':error?.code??'REQUEST_OR_BROWSER_FAILURE',step:acceptanceStep,authenticationResponse,authenticationPage},reason:'Login or tenant precondition failed; sensitive details suppressed'});}
finally {await browser?.close();}
if(process.env.TRACEPOINT_ACCEPTANCE_EXTENDED_WORKFLOWS==='enabled')results.push({name:'separately governed scenario',status:'not-run',reason:'Email invitation-link delivery remains a separate SES delivery gate. Cognito MFA/session behavior and fixture cleanup are verified by the parent harness.'});
else results.push({name:'remaining scenarios',status:'blocked',reason:'Run the parent harness with --range-documents --extended-workflows for drill/document, off-duty, fleet, training and export coverage.'});
console.log(JSON.stringify({target:baseURL,results},null,2));
const smoke = process.argv.includes('--smoke');
process.exitCode=results.some(r=>r.status==='fail')?1:smoke && email && password && department?0:results.some(r=>r.status==='blocked')?2:0;

import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const baseURL = 'https://staging.tracepointhq.com';
const routes = ['/', '/landing', '/equipment', '/range-days', '/firearms', '/off-duty-firearms', '/qualifications', '/training', '/training/certifications', '/fleet-management', '/notifications', '/settings/import-export'];
const results = [];
async function check(name, work) {
  try { await work(); results.push({ name, status: 'pass' }); }
  catch (error) { results.push({ name, status: 'fail', diagnostic: error?.code === 'ERR_ASSERTION' ? { code: error.code, actual: typeof error.actual === 'number' ? error.actual : undefined, expected: typeof error.expected === 'number' ? error.expected : undefined } : { code: 'REQUEST_OR_BROWSER_FAILURE' } }); }
}
for (const path of ['/login', '/api/health', ...routes, '/api/equipment/types']) await check(`anonymous ${path}`, async () => {
  const r = await fetch(baseURL + path, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (['/login','/api/health','/landing'].includes(path)) assert.equal(r.status, 200);
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
    assert.equal(await page.getByLabel('Email',{exact:true}).isVisible(),true);
    assert.equal(await page.getByLabel('Password',{exact:true}).isVisible(),true);
    assert.equal(await page.locator('button[type="submit"]').isVisible(),true);
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
    return [baseURL, 'https://wztqqqashilusoppddxi.supabase.co'].includes(origin) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => url.origin === baseURL && url.pathname !== '/login');
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
  await check('logout',async()=>{
    await context.request.post('/auth/signout',{maxRedirects:0});
    const r=await context.request.get('/equipment',{maxRedirects:0});assert.ok([302,303,307,308].includes(r.status()));
    assert.equal(new URL(r.headers().location,baseURL).pathname,'/login');
  });
} catch {results.push({name:'authenticated setup',status:'fail',reason:'Login or tenant precondition failed; sensitive details suppressed'});}
finally {await browser?.close();}
results.push({name:'remaining scenarios',status:'blocked',reason:'Assignments/Officer UI, drill protections, off-duty approvals, real exports, file transfer and role-negative writes need disposable fixtures and additional scenario coverage. Page loads do not prove these workflows.'});
console.log(JSON.stringify({target:baseURL,results},null,2));
const smoke = process.argv.includes('--smoke');
process.exitCode=results.some(r=>r.status==='fail')?1:smoke && email && password && department?0:results.some(r=>r.status==='blocked')?2:0;

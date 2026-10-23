import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { loginThroughCognitoPkce } from './staging-cognito-login.mjs';

const baseURL = 'https://staging.tracepointhq.com';
const pixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nm6kAAAAASUVORK5CYII=', 'base64');

export async function runAuthenticatedAcceptance({ manifest, passwords, mfaSecrets = new Map() }) {
  const results = [];
  const browser = await chromium.launch({ headless: true });
  let typeId;
  let patchCreated = false;
  const admin = manifest.users.find(user => user.agencyIndex === 0 && user.role === 'administrator');
  let adminContext;
  const add = (name, status, details = {}) => results.push({ name, status, ...details });
  try {
    for (const user of manifest.users) {
      const context = await browser.newContext({ baseURL });
      try {
        await context.route('**/*', route => {
          const origin = new URL(route.request().url()).origin;
          return [baseURL, 'https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com'].includes(origin) ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        const secret = await loginThroughCognitoPkce({ page, baseURL, email: user.email, password: passwords.get(user.email), knownMfaSecret: mfaSecrets.get(user.email) });
        if (secret) mfaSecrets.set(user.email, secret);
        const accessResponse = await context.request.get('/api/access');
        assert.equal(accessResponse.status(), 200);
        const { access } = await accessResponse.json();
        assert.equal(access.departmentId, manifest.agencies[user.agencyIndex].id);
        assert.ok(access.roleCodes.includes(user.role));
        add(`${user.role} authenticates through Cognito PKCE/MFA`, 'pass');
        await page.reload({ waitUntil: 'domcontentloaded' });
        const persisted = await context.request.get('/api/access');
        assert.equal(persisted.status(), 200);
        assert.equal((await persisted.json()).access.departmentId, manifest.agencies[user.agencyIndex].id);
        add(`${user.role} session reload preserves tenant`, 'pass');

        if (user.role === 'administrator' && user.agencyIndex === 0) {
          adminContext = context;
          const name = `acceptance-${manifest.run}-equipment-type`;
          const created = await context.request.post('/api/equipment/types', { data: { name, category: 'Staging Acceptance' } });
          assert.equal(created.status(), 201);
          const initial = (await created.json()).item; typeId = initial.id;
          assert.equal(initial.department_id, manifest.agencies[0].id);
          const editedName = `${name}-edited`;
          const edited = await context.request.patch('/api/equipment/types', { data: { id: typeId, name: editedName, category: 'Staging Acceptance' } });
          assert.equal(edited.status(), 200);
          assert.equal((await edited.json()).item.name, editedName);
          const listed = await context.request.get('/api/equipment/types');
          assert.equal(listed.status(), 200);
          assert.ok((await listed.json()).items.some(item => item.id === typeId && item.name === editedName));
          await page.reload({ waitUntil: 'domcontentloaded' });
          const reloaded = await context.request.get('/api/equipment/types');
          assert.equal(reloaded.status(), 200);
          assert.ok((await reloaded.json()).items.some(item => item.id === typeId && item.name === editedName));
          add('equipment type create → save → edit → save → reload persistence', 'pass');

          const patch = await context.request.post('/api/settings/department-patch', { multipart: { file: { name: 'acceptance.png', mimeType: 'image/png', buffer: pixelPng } } });
          assert.equal(patch.status(), 200);
          patchCreated = true;
          const auditResponse = await context.request.get('/api/settings/audit-log?limit=100');
          assert.equal(auditResponse.status(), 200);
          const audit = await auditResponse.json();
          assert.ok(audit.events.some(event => event.action === 'department_patch_upload' && event.details?.result === 'succeeded'));
          add('administrator action is present in tenant audit log', 'pass');
        } else if (user.agencyIndex === 0) {
          const write = await context.request.post('/api/equipment/types', { data: { name: `forbidden-${manifest.run}-${user.role}` } });
          assert.equal(write.status(), 403);
          add(`${user.role} cannot create administrator-only equipment types`, 'pass');
        } else {
          await context.addCookies([{ name: 'tracepoint_department_id', value: manifest.agencies[0].id, url: baseURL }]);
          const foreignTenant = await context.request.get('/api/access');
          assert.ok([200, 401, 403].includes(foreignTenant.status()));
          if (foreignTenant.status() === 200) assert.equal((await foreignTenant.json()).access.departmentId, manifest.agencies[1].id);
          const foreignWrite = await context.request.post('/api/equipment/types', { data: { name: `foreign-${manifest.run}` } });
          assert.notEqual(foreignWrite.status(), 201);
          add('Agency B identity cannot select or write Agency A tenant', 'pass');
        }
      } finally {
        if (user === admin) {
          if (typeId) {
            const deleted = await context.request.delete('/api/equipment/types', { data: { id: typeId } }).catch(() => null);
            if (deleted && deleted.status() !== 200) add('acceptance equipment type cleanup', 'fail');
            else typeId = null;
          }
          if (patchCreated) {
            await context.request.post('/api/auth/cognito/logout').catch(() => null);
            patchCreated = false;
          }
        }
        await context.close();
      }
    }
  } catch (error) {
    add('authenticated acceptance execution', 'fail', { code: error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : error?.name === 'TimeoutError' ? 'BROWSER_TIMEOUT' : 'AUTHENTICATED_FLOW_FAILED' });
  } finally {
    if (adminContext) await adminContext.close().catch(() => undefined);
    await browser.close();
  }
  return { results, mfaSecrets };
}

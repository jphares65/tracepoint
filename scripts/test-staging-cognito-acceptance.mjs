import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { loginThroughCognitoPkce } from './staging-cognito-login.mjs';

const baseURL = 'https://staging.tracepointhq.com';
const pixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nm6kAAAAASUVORK5CYII=', 'base64');

export async function runAuthenticatedAcceptance({ manifest, passwords, mfaSecrets = new Map(), onStorageObject = async () => {} }) {
  const results = [];
  const browser = await chromium.launch({ headless: true });
  let typeId;
  let patchCreated = false;
  let activeUser;
  let activePhase = 'browser-start';
  const admin = manifest.users.find(user => user.agencyIndex === 0 && user.role === 'administrator');
  let adminContext;
  const add = (name, status, details = {}) => results.push({ name, status, ...details });
  try {
    for (const user of manifest.users) {
      activeUser = user;
      activePhase = 'open-login';
      const context = await browser.newContext({ baseURL });
      try {
        await context.route('**/*', route => {
          const origin = new URL(route.request().url()).origin;
          return [baseURL, 'https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com'].includes(origin) ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        activePhase = 'cognito-pkce-mfa-login';
        const secret = await loginThroughCognitoPkce({
          page,
          baseURL,
          email: user.email,
          password: passwords.get(user.email),
          knownMfaSecret: mfaSecrets.get(user.email),
          onStep: step => { activePhase = `cognito-${step}`; },
        });
        if (secret) mfaSecrets.set(user.email, secret);
        activePhase = 'read-role-and-tenant-access';
        const accessResponse = await context.request.get('/api/access');
        assert.equal(accessResponse.status(), 200);
        const { access } = await accessResponse.json();
        assert.equal(access.departmentId, manifest.agencies[user.agencyIndex].id);
        assert.ok(access.roleCodes.includes(user.role));
        add(`${user.role} authenticates through Cognito PKCE/MFA`, 'pass');
        activePhase = 'reload-session-and-tenant';
        await page.reload({ waitUntil: 'domcontentloaded' });
        const persisted = await context.request.get('/api/access');
        assert.equal(persisted.status(), 200);
        assert.equal((await persisted.json()).access.departmentId, manifest.agencies[user.agencyIndex].id);
        add(`${user.role} session reload preserves tenant`, 'pass');

        if (user.role === 'administrator' && user.agencyIndex === 0) {
          adminContext = context;
          const name = `acceptance-${manifest.run}-equipment-type`;
          activePhase = 'administrator-create-save-edit-save-reload';
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

          activePhase = 'administrator-audit-log';
          const patch = await context.request.post('/api/settings/department-patch', { multipart: { file: { name: 'acceptance.png', mimeType: 'image/png', buffer: pixelPng } } });
          assert.equal(patch.status(), 200);
          patchCreated = true;
          // Cleanup deletes only objects recorded here; the delivery path is the object's key below department-assets/.
          await onStorageObject(`department-assets/${new URL((await patch.json()).patchUrl, baseURL).searchParams.get('path') ?? ''}`);
          const auditResponse = await context.request.get('/api/settings/audit-log?limit=100');
          assert.equal(auditResponse.status(), 200);
          const audit = await auditResponse.json();
          assert.ok(audit.events.some(event => event.action === 'department_patch_upload' && event.new_values?.result === 'succeeded'));
          add('administrator action is present in tenant audit log', 'pass');
        } else if (user.agencyIndex === 0) {
          activePhase = `${user.role}-authorization-denial`;
          const write = await context.request.post('/api/equipment/types', { data: { name: `forbidden-${manifest.run}-${user.role}` } });
          assert.equal(write.status(), 403);
          add(`${user.role} cannot create administrator-only equipment types`, 'pass');
        } else {
          activePhase = 'agency-b-cross-tenant-isolation';
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
    const errorName = /^[A-Za-z]*Error$/.test(error?.name ?? '') ? error.name : 'UnknownError';
    const role = ['officer', 'instructor', 'supervisor', 'administrator'].includes(activeUser?.role) ? activeUser.role : 'unknown';
    const diagnostics = error?.acceptanceDiagnostics;
    add('authenticated acceptance execution', 'fail', {
      code: error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : error?.name === 'TimeoutError' ? 'BROWSER_TIMEOUT' : 'AUTHENTICATED_FLOW_FAILED',
      role,
      phase: activePhase,
      errorName,
      ...(diagnostics && typeof diagnostics === 'object' ? { diagnostics: {
        barcodeDetectorAvailable: diagnostics.barcodeDetectorAvailable === true,
        imageCount: Number.isInteger(diagnostics.imageCount) ? diagnostics.imageCount : 0,
        canvasCount: Number.isInteger(diagnostics.canvasCount) ? diagnostics.canvasCount : 0,
        qrDecoded: diagnostics.qrDecoded === true,
        totpPayloadFound: diagnostics.totpPayloadFound === true,
        manualSetupVisible: diagnostics.manualSetupVisible === true,
      } } : {}),
    });
  } finally {
    if (adminContext) await adminContext.close().catch(() => undefined);
    await browser.close();
  }
  return { results, mfaSecrets };
}

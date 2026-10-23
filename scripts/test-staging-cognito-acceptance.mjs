import { chromium } from '@playwright/test';
import { loginThroughCognitoPkce } from './staging-cognito-login.mjs';

const baseURL = 'https://staging.tracepointhq.com';
const pixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nm6kAAAAASUVORK5CYII=', 'base64');

function requireAcceptance(condition, check, expected, actual) {
  if (condition) return;
  const error = new Error('Authenticated acceptance assertion failed.');
  error.name = 'AssertionError';
  error.acceptanceEvidence = { check, expected, actual };
  throw error;
}

export async function runAuthenticatedAcceptance({ manifest, passwords, mfaSecrets = new Map(), onStorageObject = async () => {}, onResult = async () => {} }) {
  const results = [];
  const browser = await chromium.launch({ headless: true });
  let typeId;
  let patchCreated = false;
  let activeUser;
  let activePhase = 'browser-start';
  const admin = manifest.users.find(user => user.agencyIndex === 0 && user.role === 'administrator');
  let adminContext;
  const add = async (name, status, details = {}) => {
    const result = { name, status, ...details };
    results.push(result);
    await onResult(result);
  };
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
        const accessStatus = accessResponse.status();
        let access = null;
        if (accessStatus === 200) access = (await accessResponse.json()).access;
        const roleAccessEvidence = {
          expected: { httpStatus: 200, tenantMatches: true, rolePresent: true },
          actual: {
            httpStatus: accessStatus,
            tenantMatches: access?.departmentId === manifest.agencies[user.agencyIndex].id,
            rolePresent: Array.isArray(access?.roleCodes) && access.roleCodes.includes(user.role),
          },
        };
        requireAcceptance(accessStatus === 200 && roleAccessEvidence.actual.tenantMatches && roleAccessEvidence.actual.rolePresent,
          'authenticated-role-and-tenant-access', roleAccessEvidence.expected, roleAccessEvidence.actual);
        await add(`${user.role} authenticates through Cognito PKCE/MFA`, 'pass', { evidence: roleAccessEvidence });
        activePhase = 'reload-session-and-tenant';
        await page.reload({ waitUntil: 'domcontentloaded' });
        const persisted = await context.request.get('/api/access');
        const persistedStatus = persisted.status();
        const persistedAccess = persistedStatus === 200 ? (await persisted.json()).access : null;
        const reloadEvidence = {
          expected: { httpStatus: 200, tenantMatches: true },
          actual: { httpStatus: persistedStatus, tenantMatches: persistedAccess?.departmentId === manifest.agencies[user.agencyIndex].id },
        };
        requireAcceptance(reloadEvidence.actual.httpStatus === 200 && reloadEvidence.actual.tenantMatches,
          'session-reload-tenant-persistence', reloadEvidence.expected, reloadEvidence.actual);
        await add(`${user.role} session reload preserves tenant`, 'pass', { evidence: reloadEvidence });

        if (user.role === 'administrator' && user.agencyIndex === 0) {
          adminContext = context;
          const name = `acceptance-${manifest.run}-equipment-type`;
          activePhase = 'administrator-create-save-edit-save-reload';
          const created = await context.request.post('/api/equipment/types', { data: { name, category: 'Staging Acceptance' } });
          requireAcceptance(created.status() === 201, 'equipment-type-create', { httpStatus: 201 }, { httpStatus: created.status() });
          const initial = (await created.json()).item; typeId = initial.id;
          requireAcceptance(initial.department_id === manifest.agencies[0].id, 'equipment-type-create-tenant', { tenantMatches: true }, { tenantMatches: initial.department_id === manifest.agencies[0].id });
          const editedName = `${name}-edited`;
          const edited = await context.request.patch('/api/equipment/types', { data: { id: typeId, name: editedName, category: 'Staging Acceptance' } });
          requireAcceptance(edited.status() === 200, 'equipment-type-edit', { httpStatus: 200 }, { httpStatus: edited.status() });
          const editedItem = (await edited.json()).item;
          requireAcceptance(editedItem.name === editedName, 'equipment-type-edit-value', { editedValuePersisted: true }, { editedValuePersisted: editedItem.name === editedName });
          const listed = await context.request.get('/api/equipment/types');
          requireAcceptance(listed.status() === 200, 'equipment-type-save-readback', { httpStatus: 200 }, { httpStatus: listed.status() });
          const listedItems = (await listed.json()).items;
          const listedPersisted = listedItems.some(item => item.id === typeId && item.name === editedName);
          requireAcceptance(listedPersisted, 'equipment-type-save-readback-value', { editedValuePersisted: true }, { editedValuePersisted: listedPersisted });
          await page.reload({ waitUntil: 'domcontentloaded' });
          const reloaded = await context.request.get('/api/equipment/types');
          requireAcceptance(reloaded.status() === 200, 'equipment-type-reload-readback', { httpStatus: 200 }, { httpStatus: reloaded.status() });
          const reloadedItems = (await reloaded.json()).items;
          const reloadPersisted = reloadedItems.some(item => item.id === typeId && item.name === editedName);
          requireAcceptance(reloadPersisted, 'equipment-type-reload-persistence', { editedValuePersisted: true }, { editedValuePersisted: reloadPersisted });
          await add('equipment type create → save → edit → save → reload persistence', 'pass', {
            evidence: { expected: { createStatus: 201, editStatus: 200, editedValuePersistedAfterReload: true }, actual: { createStatus: created.status(), editStatus: edited.status(), editedValuePersistedAfterReload: reloadPersisted } },
          });

          activePhase = 'administrator-audit-log';
          const patch = await context.request.post('/api/settings/department-patch', { multipart: { file: { name: 'acceptance.png', mimeType: 'image/png', buffer: pixelPng } } });
          requireAcceptance(patch.status() === 200, 'department-patch-audit-workflow', { httpStatus: 200 }, { httpStatus: patch.status() });
          patchCreated = true;
          // Cleanup deletes only objects recorded here; the delivery path is the object's key below department-assets/.
          await onStorageObject(`department-assets/${new URL((await patch.json()).patchUrl, baseURL).searchParams.get('path') ?? ''}`);
          const auditResponse = await context.request.get('/api/settings/audit-log?limit=100');
          const auditStatus = auditResponse.status();
          const audit = auditStatus === 200 ? await auditResponse.json() : { events: [] };
          const auditEvents = Array.isArray(audit.events) ? audit.events : [];
          const matchingActionEvents = auditEvents.filter(event => event.action === 'department_patch_upload');
          const successfulEvents = matchingActionEvents.filter(event => event.new_values?.result === 'succeeded');
          const auditEvidence = {
            expected: { httpStatus: 200, action: 'department_patch_upload', result: 'succeeded', atLeastOneMatch: true },
            actual: { httpStatus: auditStatus, eventsReturned: auditEvents.length, matchingActionEvents: matchingActionEvents.length, successfulEvents: successfulEvents.length },
          };
          requireAcceptance(auditStatus === 200 && successfulEvents.length > 0,
            'administrator-audit-event-in-tenant-feed', auditEvidence.expected, auditEvidence.actual);
          await add('administrator action is present in tenant audit log', 'pass', { evidence: auditEvidence });
        } else if (user.agencyIndex === 0) {
          activePhase = `${user.role}-authorization-denial`;
          const write = await context.request.post('/api/equipment/types', { data: { name: `forbidden-${manifest.run}-${user.role}` } });
          const refusalEvidence = { expected: { httpStatus: 403 }, actual: { httpStatus: write.status() } };
          requireAcceptance(write.status() === 403, 'direct-api-administrator-only-write-refusal', refusalEvidence.expected, refusalEvidence.actual);
          await add(`${user.role} cannot create administrator-only equipment types`, 'pass', { evidence: refusalEvidence });
        } else {
          activePhase = 'agency-b-cross-tenant-isolation';
          await context.addCookies([{ name: 'tracepoint_department_id', value: manifest.agencies[0].id, url: baseURL }]);
          const foreignTenant = await context.request.get('/api/access');
          const foreignTenantStatus = foreignTenant.status();
          const foreignTenantAccess = foreignTenantStatus === 200 ? (await foreignTenant.json()).access : null;
          const tenantIsolationEvidence = {
            expected: { accessStatus: '200-for-agency-B-or-401/403', tenantRemainsAgencyB: true },
            actual: {
              accessStatus: foreignTenantStatus,
              tenantRemainsAgencyB: foreignTenantStatus !== 200 || foreignTenantAccess?.departmentId === manifest.agencies[1].id,
            },
          };
          requireAcceptance([200, 401, 403].includes(foreignTenantStatus) && tenantIsolationEvidence.actual.tenantRemainsAgencyB,
            'agency-b-cannot-select-agency-a', tenantIsolationEvidence.expected, tenantIsolationEvidence.actual);
          const foreignWrite = await context.request.post('/api/equipment/types', { data: { name: `foreign-${manifest.run}` } });
          const writeStatus = foreignWrite.status();
          requireAcceptance(writeStatus !== 201, 'agency-b-direct-api-write-refusal', { createStatusIsNot201: true }, { createStatusIsNot201: writeStatus !== 201, httpStatus: writeStatus });
          await add('Agency B identity cannot select or write Agency A tenant', 'pass', {
            evidence: { expected: { tenantRemainsAgencyB: true, crossTenantCreateRejected: true }, actual: { tenantRemainsAgencyB: tenantIsolationEvidence.actual.tenantRemainsAgencyB, accessStatus: foreignTenantStatus, crossTenantCreateRejected: writeStatus !== 201, createStatus: writeStatus } },
          });
        }
      } finally {
        if (user === admin) {
          if (typeId) {
            const deleted = await context.request.delete('/api/equipment/types', { data: { id: typeId } }).catch(() => null);
            if (deleted && deleted.status() !== 200) await add('acceptance equipment type cleanup', 'fail', { evidence: { expected: { httpStatus: 200 }, actual: { httpStatus: deleted.status() } } });
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
    await add('authenticated acceptance execution', 'fail', {
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
        onCognitoHost: diagnostics.onCognitoHost === true,
        callbackReached: diagnostics.callbackReached === true,
        hostClass: ['application', 'cognito', 'other'].includes(diagnostics.hostClass) ? diagnostics.hostClass : 'unknown',
        pathClass: ['login', 'home', 'callback', 'other'].includes(diagnostics.pathClass) ? diagnostics.pathClass : 'unknown',
        mfaPromptVisible: diagnostics.mfaPromptVisible === true,
        otpInputVisible: diagnostics.otpInputVisible === true,
        passwordInputVisible: diagnostics.passwordInputVisible === true,
        invalidCodeNotice: diagnostics.invalidCodeNotice === true,
        expiredCodeNotice: diagnostics.expiredCodeNotice === true,
        retryNotice: diagnostics.retryNotice === true,
        genericRequestError: diagnostics.genericRequestError === true,
        totpSubmissions: Number.isInteger(diagnostics.totpSubmissions) ? diagnostics.totpSubmissions : 0,
        callbackStatus: Number.isInteger(diagnostics.callbackStatus) ? diagnostics.callbackStatus : null,
      } } : {}),
      ...(error?.acceptanceEvidence ? { evidence: error.acceptanceEvidence } : {}),
    });
  } finally {
    if (adminContext) await adminContext.close().catch(() => undefined);
    await browser.close();
  }
  return { results, mfaSecrets };
}

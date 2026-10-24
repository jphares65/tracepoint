import { chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';
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

function hasPermission(access, permissions) {
  const granted = new Set(Array.isArray(access?.permissions) ? access.permissions : []);
  return granted.has('administer_department') || permissions.some(permission => granted.has(permission));
}

function permissionProfile(access) {
  return {
    equipmentManager: hasPermission(access, ['manage_equipment']),
    fleetManager: hasPermission(access, ['manage_fleet']),
    firearmManager: hasPermission(access, ['manage_firearms']),
    firearmStatusManager: hasPermission(access, ['manage_firearms', 'manage_inspections']),
    firearmRestrictionManager: hasPermission(access, ['manage_firearm_restrictions']),
    restrictedCustodyManager: hasPermission(access, ['manage_restricted_firearm_custody']),
    auditViewer: hasPermission(access, ['view_audit_log']),
  };
}

// launchBrowser and login are replaceable only so tests can count sign-ins; the staging run uses the defaults.
export async function runAuthenticatedAcceptance({ manifest, passwords, mfaSecrets = new Map(), onStorageObject = async () => {}, onResult = async () => {},
  launchBrowser = () => chromium.launch({ headless: true }), login = loginThroughCognitoPkce }) {
  const results = [];
  const browser = await launchBrowser();
  let typeId;
  let equipmentAssetId;
  let firearmId;
  let activeUser;
  let activePhase = 'browser-start';
  const admin = manifest.users.find(user => user.agencyIndex === 0 && user.role === 'administrator');
  const officer = manifest.users.find(user => user.agencyIndex === 0 && user.role === 'officer');
  let adminContext;
  let adminDepartmentMatches = false;
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
        const secret = await login({
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

        requireAcceptance(Array.isArray(access?.permissions), 'application-access-contract-includes-effective-permissions',
          { effectivePermissionsPresent: true }, { effectivePermissionsPresent: Array.isArray(access?.permissions) });
        const capabilities = permissionProfile(access);
        await add(`${user.role} permissions are read from the application access contract`, 'pass', {
          evidence: { expected: { rolePresent: true, administratorAuthority: true },
            actual: { rolePresent: true, administratorAuthority: user.role !== 'administrator' || hasPermission(access, ['administer_department']), ...capabilities } },
        });
        const denyIfUnauthorized = async (name, authorized, operation, expectedStatus = 403) => {
          if (authorized) return;
          activePhase = name;
          const response = await operation();
          const actual = { httpStatus: response.status(), refused: response.status() === expectedStatus };
          const expected = { httpStatus: expectedStatus, refused: true };
          requireAcceptance(actual.refused, name, expected, actual);
          await add(name, 'pass', { evidence: { expected, actual } });
        };
        await denyIfUnauthorized('unauthorized-fleet-status-change-refused', capabilities.fleetManager,
          () => context.request.patch('/api/fleet/vehicles', { data: { id: randomUUID(), status: 'Attention', reason: 'staging acceptance authorization check' } }));
        await denyIfUnauthorized('unauthorized-equipment-management-refused', capabilities.equipmentManager,
          () => context.request.post('/api/equipment/types', { data: { name: `forbidden-${manifest.run}-${user.role}` } }));
        await denyIfUnauthorized('unauthorized-firearm-management-refused', capabilities.firearmManager,
          () => context.request.post('/api/armory/firearms', { data: {} }));
        await denyIfUnauthorized('unauthorized-firearm-status-change-refused', capabilities.firearmStatusManager,
          () => context.request.patch(`/api/armory/firearms/${randomUUID()}/status`, { data: { status: 'Out of Service', notes: 'staging acceptance authorization check' } }));
        await denyIfUnauthorized('unauthorized-firearm-assignment-refused', capabilities.firearmManager,
          () => context.request.post(`/api/armory/firearms/${firearmId ?? randomUUID()}/assignments`, { data: { assignedToUserId: user.userId } }));
        await denyIfUnauthorized('unauthorized-firearm-restriction-management-refused', capabilities.firearmRestrictionManager,
          () => context.request.put(`/api/armory/firearms/${randomUUID()}/custody`, { data: { restrictionType: 'duty_only', reason: 'staging acceptance authorization check' } }));
        await denyIfUnauthorized('unauthorized-restricted-firearm-custody-refused', capabilities.restrictedCustodyManager,
          () => context.request.post(`/api/armory/firearms/${firearmId ?? randomUUID()}/custody`, { data: { action: 'CHECK_OUT', idempotencyKey: randomUUID() } }));
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
          adminDepartmentMatches = access?.departmentId === manifest.agencies[0].id;
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

          activePhase = 'administrator-create-equipment-asset-assigned-to-officer';
          const assetName = `acceptance-${manifest.run.replaceAll('-', '').slice(0, 20)}`;
          const createdAsset = await context.request.post('/api/equipment/assets', { data: {
            equipmentTypeId: typeId, manufacturer: 'Acceptance', model: 'Condition Test',
            serialNumber: assetName, assetNumber: assetName, assignedUserId: officer.id, lifecycleStatus: 'active',
          } });
          requireAcceptance(createdAsset.status() === 201, 'administrator-equipment-asset-create', { httpStatus: 201 }, { httpStatus: createdAsset.status() });
          const asset = (await createdAsset.json()).item;
          equipmentAssetId = asset?.id;
          const createdAssetMatches = asset?.department_id === manifest.agencies[0].id &&
            asset?.assigned_user_id === officer.id && asset?.lifecycle_status === 'active';
          requireAcceptance(createdAssetMatches, 'administrator-equipment-asset-assignment', { agencyMatches: true, officerAssignmentMatches: true, active: true }, {
            agencyMatches: asset?.department_id === manifest.agencies[0].id,
            officerAssignmentMatches: asset?.assigned_user_id === officer.id,
            active: asset?.lifecycle_status === 'active',
          });
          await page.reload({ waitUntil: 'domcontentloaded' });
          const assetReadback = await context.request.get('/api/equipment/assets');
          const assetReadbackStatus = assetReadback.status();
          const assetItems = assetReadbackStatus === 200 ? (await assetReadback.json()).items : [];
          const assetPersisted = Array.isArray(assetItems) && assetItems.some(item =>
            item.id === equipmentAssetId && item.department_id === manifest.agencies[0].id &&
            item.assigned_user_id === officer.id && item.lifecycle_status === 'active');
          const assetEvidence = {
            expected: { createStatus: 201, reloadStatus: 200, persistedInDatabaseReadPath: true },
            actual: { createStatus: createdAsset.status(), reloadStatus: assetReadbackStatus, persistedInDatabaseReadPath: assetPersisted },
          };
          requireAcceptance(assetPersisted, 'administrator-equipment-asset-save-reload-persistence', assetEvidence.expected, assetEvidence.actual);
          await add('administrator creates, assigns, saves, and reloads the D-2 equipment asset', 'pass', { evidence: assetEvidence });

          activePhase = 'administrator-create-assigned-restricted-firearm-fixture';
          const supervisor = manifest.users.find(candidate => candidate.agencyIndex === 0 && candidate.role === 'supervisor');
          const createdFirearm = await context.request.post('/api/armory/firearms', { data: {
            make: 'Acceptance', model: 'Custody Authorization', serialNumber: `ACCEPTANCE-${manifest.run}`,
            firearmType: 'handgun', caliber: 'TBD / Unknown', conditionStatus: 'In Service', assignedToUserId: supervisor.id,
          } });
          const firearmCreateStatus = createdFirearm.status();
          const firearmCreateBody = firearmCreateStatus === 201 ? await createdFirearm.json() : {};
          firearmId = firearmCreateBody.firearmId;
          requireAcceptance(firearmCreateStatus === 201 && typeof firearmId === 'string' && firearmCreateBody.assignmentCreated === true,
            'administrator-provisions-isolated-assigned-firearm-fixture', { httpStatus: 201, assignmentCreated: true }, {
              httpStatus: firearmCreateStatus, assignmentCreated: firearmCreateBody.assignmentCreated === true,
            });
          const restriction = await context.request.put(`/api/armory/firearms/${firearmId}/custody`, { data: {
            restrictionType: 'duty_only', effectiveDate: new Date().toISOString().slice(0, 10),
            reason: 'Staging acceptance custody authorization check',
          } });
          const restrictionStatus = restriction.status();
          requireAcceptance(restrictionStatus === 200, 'administrator-establishes-isolated-duty-only-custody-fixture',
            { httpStatus: 200 }, { httpStatus: restrictionStatus });
          await add('Administrator provisions a temporary assigned Duty Only firearm for authorization checks', 'pass', {
            evidence: { expected: { firearmCreated: true, assignedToSupervisor: true, restrictionCreated: true },
              actual: { firearmCreated: firearmCreateStatus === 201, assignedToSupervisor: firearmCreateBody.assignmentCreated === true, restrictionCreated: restrictionStatus === 200 } },
          });

          activePhase = 'administrator-audit-log';
          const patch = await context.request.post('/api/settings/department-patch', { multipart: { file: { name: 'acceptance.png', mimeType: 'image/png', buffer: pixelPng } } });
          requireAcceptance(patch.status() === 200, 'department-patch-audit-workflow', { httpStatus: 200 }, { httpStatus: patch.status() });
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
        } else if (user.agencyIndex === 0 && user.role === 'officer') {
          activePhase = 'officer-reports-equipment-condition';
          requireAcceptance(typeof equipmentAssetId === 'string' && typeof typeId === 'string',
            'd2-fixture-asset-exists-for-officer', { assetProvisioned: true }, { assetProvisioned: typeof equipmentAssetId === 'string' });
          const report = await context.request.post('/api/equipment/custody', { data: {
            id: equipmentAssetId, action: 'report-condition', condition: 'damaged',
            notes: 'Staging acceptance condition report.',
          } });
          const reportStatus = report.status();
          const reportItem = reportStatus === 200 ? (await report.json()).item : null;
          const reportSucceeded = reportItem?.id === equipmentAssetId && reportItem?.lifecycle_status === 'out_of_service' && reportItem?.custody === 'mine';
          const reportEvidence = {
            expected: { httpStatus: 200, saved: true, outOfService: true, officerCustodyRetained: true },
            actual: { httpStatus: reportStatus, saved: reportSucceeded, outOfService: reportItem?.lifecycle_status === 'out_of_service', officerCustodyRetained: reportItem?.custody === 'mine' },
          };
          requireAcceptance(reportSucceeded, 'd2-officer-condition-report-saved-out-of-service', reportEvidence.expected, reportEvidence.actual);
          await page.reload({ waitUntil: 'domcontentloaded' });
          const savedAssetsResponse = await context.request.get('/api/equipment/assets');
          const savedAssetsStatus = savedAssetsResponse.status();
          const savedAssets = savedAssetsStatus === 200 ? (await savedAssetsResponse.json()).items : [];
          const savedAsset = Array.isArray(savedAssets) ? savedAssets.find(item => item.id === equipmentAssetId) : null;
          const conditionPersisted = savedAsset?.department_id === manifest.agencies[0].id &&
            savedAsset?.assigned_user_id === user.id && savedAsset?.lifecycle_status === 'out_of_service' &&
            typeof savedAsset?.notes === 'string' && savedAsset.notes.includes('[condition=damaged]') &&
            savedAsset.notes.includes(`[reported_by=${user.id}]`);
          const persistenceEvidence = {
            expected: { reloadStatus: 200, databaseReadback: true, outOfService: true, conditionSaved: true },
            actual: { reloadStatus: savedAssetsStatus, databaseReadback: conditionPersisted, outOfService: savedAsset?.lifecycle_status === 'out_of_service', conditionSaved: typeof savedAsset?.notes === 'string' && savedAsset.notes.includes('[condition=damaged]') },
          };
          requireAcceptance(conditionPersisted, 'd2-officer-condition-report-database-persistence-after-reload', persistenceEvidence.expected, persistenceEvidence.actual);
          await add('D-2 Officer condition report persists after reload', 'pass', { evidence: { ...reportEvidence, databaseReadback: persistenceEvidence.actual } });
        } else if (user.agencyIndex === 1) {
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
          await context.addCookies([{ name: 'tracepoint_department_id', value: manifest.agencies[1].id, url: baseURL }]);
          const restoredTenant = await context.request.get('/api/access');
          const restoredTenantStatus = restoredTenant.status();
          const restoredTenantAccess = restoredTenantStatus === 200 ? (await restoredTenant.json()).access : null;
          const restoredTenantEvidence = {
            expected: { httpStatus: 200, tenantMatchesAgencyB: true },
            actual: { httpStatus: restoredTenantStatus, tenantMatchesAgencyB: restoredTenantAccess?.departmentId === manifest.agencies[1].id },
          };
          requireAcceptance(restoredTenantStatus === 200 && restoredTenantEvidence.actual.tenantMatchesAgencyB,
            'agency-b-session-remains-on-agency-b-before-direct-api-probes', restoredTenantEvidence.expected, restoredTenantEvidence.actual);
          await add('Agency B session is verified before direct API isolation probes', 'pass', { evidence: restoredTenantEvidence });
          requireAcceptance(typeof equipmentAssetId === 'string', 'agency-a-d2-asset-is-available-for-isolation-check', { assetProvisioned: true }, { assetProvisioned: typeof equipmentAssetId === 'string' });
          const foreignRead = await context.request.get(`/api/equipment/custody?identifier=${encodeURIComponent(equipmentAssetId)}`);
          const foreignReadBody = foreignRead.status() === 404 ? await foreignRead.json() : {};
          const foreignReadEvidence = {
            expected: { httpStatus: 404, noForeignRecordExposed: true },
            actual: { httpStatus: foreignRead.status(), noForeignRecordExposed: foreignRead.status() === 404 && !JSON.stringify(foreignReadBody).includes(equipmentAssetId) },
          };
          requireAcceptance(foreignRead.status() === 404 && foreignReadEvidence.actual.noForeignRecordExposed,
            'agency-b-direct-api-read-of-agency-a-equipment-denied', foreignReadEvidence.expected, foreignReadEvidence.actual);
          await add('Agency B cannot read Agency A equipment by direct API', 'pass', { evidence: foreignReadEvidence });

          const directoryResponse = await context.request.get('/api/equipment/assets');
          const directoryStatus = directoryResponse.status();
          const directoryItems = directoryStatus === 200 ? (await directoryResponse.json()).items : [];
          const foreignAssetAbsent = Array.isArray(directoryItems) && !directoryItems.some(item => item.id === equipmentAssetId);
          const directoryEvidence = {
            expected: { httpStatus: 200, agencyAAssetAbsent: true },
            actual: { httpStatus: directoryStatus, agencyAAssetAbsent: foreignAssetAbsent },
          };
          requireAcceptance(directoryStatus === 200 && foreignAssetAbsent,
            'agency-b-equipment-directory-excludes-agency-a-records', directoryEvidence.expected, directoryEvidence.actual);
          await add('Agency B equipment directory excludes Agency A asset', 'pass', { evidence: directoryEvidence });

          const foreignWrite = await context.request.post('/api/equipment/custody', { data: {
            id: equipmentAssetId, action: 'report-condition', condition: 'damaged', notes: 'Cross-agency acceptance probe.',
          } });
          const foreignWriteBody = foreignWrite.status() === 404 ? await foreignWrite.json() : {};
          const foreignWriteEvidence = {
            expected: { httpStatus: 404, noForeignRecordExposed: true },
            actual: { httpStatus: foreignWrite.status(), noForeignRecordExposed: foreignWrite.status() === 404 && !JSON.stringify(foreignWriteBody).includes(equipmentAssetId) },
          };
          requireAcceptance(foreignWrite.status() === 404 && foreignWriteEvidence.actual.noForeignRecordExposed,
            'agency-b-direct-api-modification-of-agency-a-equipment-denied', foreignWriteEvidence.expected, foreignWriteEvidence.actual);
          await add('Agency B cannot modify Agency A equipment by direct API', 'pass', { evidence: foreignWriteEvidence });
        }
      } finally {
        if (context !== adminContext) await context.close();
      }
    }

    activeUser = admin;
    activePhase = 'administrator-audit-log-d2-event';
    requireAcceptance(adminContext && equipmentAssetId && officer && adminDepartmentMatches,
      'd2-audit-check-has-administrator-agency-context', { administratorAgencyMatches: true }, { administratorAgencyMatches: adminDepartmentMatches });
    const auditResponse = await adminContext.request.get('/api/settings/audit-log?limit=100');
    const auditStatus = auditResponse.status();
    const audit = auditStatus === 200 ? await auditResponse.json() : { events: [] };
    const events = Array.isArray(audit.events) ? audit.events : [];
    const d2Events = events.filter(event => event.action === 'report' && event.entity_type === 'equipment_asset' &&
      event.entity_id === equipmentAssetId && event.changed_by_user_id === officer.id &&
      event.new_values?.equipment_asset_id === equipmentAssetId && event.new_values?.condition === 'damaged' &&
      event.new_values?.lifecycle_status === 'out_of_service');
    const d2AuditEvidence = {
      expected: { httpStatus: 200, action: 'report', agencyMatches: true, officerMatches: true, equipmentMatches: true, conditionMatches: true },
      actual: {
        httpStatus: auditStatus, agencyMatches: adminDepartmentMatches && d2Events.length > 0,
        officerMatches: d2Events.some(event => event.changed_by_user_id === officer.id),
        equipmentMatches: d2Events.some(event => event.entity_id === equipmentAssetId && event.new_values?.equipment_asset_id === equipmentAssetId),
        conditionMatches: d2Events.some(event => event.new_values?.condition === 'damaged' && event.new_values?.lifecycle_status === 'out_of_service'),
      },
    };
    requireAcceptance(auditStatus === 200 && d2AuditEvidence.actual.agencyMatches &&
      d2AuditEvidence.actual.officerMatches && d2AuditEvidence.actual.equipmentMatches && d2AuditEvidence.actual.conditionMatches,
    'd2-audit-event-identifies-agency-officer-and-equipment', d2AuditEvidence.expected, d2AuditEvidence.actual);
    await add('D-2 normalized audit event identifies the agency, Officer, and equipment', 'pass', { evidence: d2AuditEvidence });
  } catch (error) {
    const errorName = /^[A-Za-z]*Error$/.test(error?.name ?? '') ? error.name : 'UnknownError';
    const role = ['officer', 'instructor', 'supervisor', 'administrator'].includes(activeUser?.role) ? activeUser.role : 'unknown';
    const diagnostics = error?.acceptanceDiagnostics;
    await add(error?.acceptanceEvidence?.check ?? 'authenticated acceptance execution', 'fail', {
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
    if (adminContext) {
      await adminContext.request.post('/api/auth/cognito/logout').catch(() => undefined);
      await adminContext.close().catch(() => undefined);
    }
    await browser.close();
  }
  return { results, mfaSecrets };
}

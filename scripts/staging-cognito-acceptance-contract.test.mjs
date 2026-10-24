import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(path, 'utf8');

test('D-2 acceptance follows equipment route status, state, and audit contracts', async () => {
  const [acceptance, assets, custody, audit] = await Promise.all([
    read('scripts/test-staging-cognito-acceptance.mjs'),
    read('src/app/api/equipment/assets/route.ts'),
    read('src/app/api/equipment/custody/route.ts'),
    read('src/lib/tracepoint/audit-server.ts'),
  ]);
  assert.match(assets, /if \(!context\.canManage\) return equipmentPermissionDenied\(\)/);
  assert.match(assets, /\{ status: 201 \}/);
  assert.match(acceptance, /createdAsset\.status\(\) === 201/);
  assert.match(acceptance, /assignedUserId: officer\.id/);
  assert.match(custody, /action === "report-condition"/);
  assert.match(custody, /lifecycle_status: "out_of_service"/);
  assert.match(custody, /action: "report"/);
  assert.match(acceptance, /reportStatus === 200/);
  assert.match(acceptance, /savedAsset\?\.lifecycle_status === 'out_of_service'/);
  assert.match(acceptance, /changed_by_user_id === officer\.id/);
  assert.match(acceptance, /event\.entity_id === equipmentAssetId/);
  assert.match(audit, /new_values:[\s\S]*asStoredObject\(details\)/);
  assert.match(acceptance, /event\.new_values\?\.condition === 'damaged'/);
});

test('authorization and tenant assertions match the current HTTP refusal contracts', async () => {
  const [acceptance, fleet, firearms, firearmAssignments, firearmStatus, firearmCustody, equipmentCustody] = await Promise.all([
    read('scripts/test-staging-cognito-acceptance.mjs'),
    read('src/app/api/fleet/vehicles/route.ts'),
    read('src/app/api/armory/firearms/route.ts'),
    read('src/app/api/armory/firearms/[firearmId]/assignments/route.ts'),
    read('src/app/api/armory/firearms/[firearmId]/status/route.ts'),
    read('src/app/api/armory/firearms/[firearmId]/custody/route.ts'),
    read('src/app/api/equipment/custody/route.ts'),
  ]);
  assert.match(fleet, /Fleet management permission is required\.[\s\S]*status: 403/);
  assert.match(acceptance, /unauthorized-fleet-status-change-refused/);
  assert.match(firearms, /hasAnyServerPermission\(context, \["manage_firearms"\]\)/);
  assert.match(acceptance, /unauthorized-firearm-management-refused/);
  assert.match(firearmStatus, /"manage_firearms",\s*"manage_inspections"[\s\S]*permissionDeniedResponse/);
  assert.match(acceptance, /unauthorized-firearm-status-change-refused/);
  assert.match(firearmAssignments, /hasAnyServerPermission\(context, \["manage_firearms"\]\)[\s\S]*permissionDeniedResponse/);
  assert.match(acceptance, /unauthorized-firearm-assignment-refused/);
  assert.match(firearmCustody, /!hasAnyServerPermission\(context, \["manage_firearm_restrictions"\]\)[\s\S]*permissionDeniedResponse/);
  assert.match(firearmCustody, /operate_restricted_firearm_custody/);
  assert.match(acceptance, /unauthorized-firearm-restriction-management-refused/);
  assert.match(acceptance, /unauthorized-restricted-firearm-custody-refused/);
  assert.match(equipmentCustody, /if \(!existing\) return errorResponse\("Equipment was not found in your agency\.", 404\)/);
  assert.match(acceptance, /agency-b-direct-api-read-of-agency-a-equipment-denied/);
  assert.match(acceptance, /agency-b-direct-api-modification-of-agency-a-equipment-denied/);
});

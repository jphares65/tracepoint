import test from 'node:test';
import assert from 'node:assert/strict';
import { projectOmittedAgencyPatches } from './production-final-patch-omission.mjs';
import { snapshotFromArtifact } from './production-final-relation-adapter.mjs';
import { MIGRATION_RELATIONS } from './supabase-rest-ledger-core.mjs';

const project = 'reukdouvpshshvqnzsgw';
const id = 'acb5b501-2309-4a9e-a504-f36c08728fa9';
const key = `${id}/patch-source-rehearsal-20260925.png`;
const reference = `https://${project}.supabase.co/storage/v1/object/public/department-assets/${key}`;
const object = { sourceBucket: 'department-assets', sourceKey: key,
  destinationKey: `department-assets/${key}`, departmentId: id, bytes: 68,
  sha256: 'a'.repeat(64) };
const artifact = () => ({
  tables: MIGRATION_RELATIONS.map(name => ({ name })),
  rows: { ...Object.fromEntries(MIGRATION_RELATIONS.map(name => [name, []])),
    departments: [{ id, patch_url: reference, name: 'synthetic', updated_at: '2026-09-25T00:00:00Z' }] },
  objects: { manifest: [object], count: 1, totalBytes: 68 },
  identities: { rows: [], count: 0 }, memberships: { count: 0 },
  totalRelationalRows: 1, masterSha256: 'b'.repeat(64),
});

test('only approved synthetic patch becomes valid no-patch state without changing other fields', () => {
  const source = artifact();
  const projected = projectOmittedAgencyPatches(source, project);
  assert.equal(projected.projectedDepartments[0].patch_url, null);
  assert.equal(projected.projectedDepartments[0].name, 'synthetic');
  assert.equal(source.rows.departments[0].patch_url, reference);
  assert.equal(projected.inScopeManifest.length, 0);
  assert.deepEqual(projected.omitted.map(item => [item.departmentId, item.priorSourceReference]), [[id, reference]]);
  const snapshot = snapshotFromArtifact(source, project);
  assert.equal(snapshot.rows.get('departments')[0].patch_url, null);
  assert.equal(snapshot.departmentPatchNormalization.originalDepartmentRows[0].patch_url, reference);
  assert.equal(snapshot.baseline.objects, 0);
});

test('unknown, additional, missing, duplicate, or cross-tenant patch mappings fail closed', () => {
  const additional = artifact();
  additional.rows.departments.push({ id: '00000000-0000-4000-8000-000000000001', patch_url: reference });
  assert.throws(() => projectOmittedAgencyPatches(additional, project), /PATCH_OMISSION_REFERENCE_COUNT_CHANGED/);
  const absent = artifact(); absent.objects.manifest = [];
  assert.throws(() => projectOmittedAgencyPatches(absent, project), /PATCH_OMISSION_OBJECT_COUNT_CHANGED/);
  const wrongOwner = artifact(); wrongOwner.objects.manifest[0] = { ...object, departmentId: 'other' };
  assert.throws(() => projectOmittedAgencyPatches(wrongOwner, project), /PATCH_OMISSION_OBJECT_OWNER_MISMATCH/);
  const wrongOrigin = artifact(); wrongOrigin.rows.departments[0].patch_url = reference.replace(project, 'other');
  assert.throws(() => projectOmittedAgencyPatches(wrongOrigin, project), /PATCH_OMISSION_ORIGIN_MISMATCH/);
  const duplicate = artifact(); duplicate.objects.manifest.push({ ...object });
  assert.throws(() => projectOmittedAgencyPatches(duplicate, project), /PATCH_OMISSION_OBJECT_COUNT_CHANGED/);
});

import assert from 'node:assert/strict';
import { canonicalRowsHash, quote } from './supabase-rest-import-core.mjs';
import { sha256 } from './supabase-rest-ledger-core.mjs';
import { SOURCE_PROJECT_REF } from './source-production-final-capture-core.mjs';

const OMITTED = Object.freeze({
  [SOURCE_PROJECT_REF]: Object.freeze([
    '1d0e2994-4224-4237-8328-71020ba20027',
    'd01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0',
  ]),
  reukdouvpshshvqnzsgw: Object.freeze(['acb5b501-2309-4a9e-a504-f36c08728fa9']),
});
const EXPECTED_KEYS = Object.freeze({
  [SOURCE_PROJECT_REF]: Object.freeze({
    '1d0e2994-4224-4237-8328-71020ba20027':
      '1d0e2994-4224-4237-8328-71020ba20027/patch-1787431778595.jpg',
    'd01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0':
      'd01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0/patch-1782439034425.png',
  }),
  reukdouvpshshvqnzsgw: Object.freeze({
    'acb5b501-2309-4a9e-a504-f36c08728fa9':
      'acb5b501-2309-4a9e-a504-f36c08728fa9/patch-source-rehearsal-20260925.png',
  }),
});

/** Owner-approved omission of only the pinned agency patches; all other bytes remain in scope. */
export function projectOmittedAgencyPatches(artifact, sourceProjectRef) {
  const allowed = OMITTED[sourceProjectRef];
  assert.ok(allowed, 'PATCH_OMISSION_SOURCE_NOT_APPROVED');
  const departments = artifact.rows.departments;
  const manifest = artifact.objects.manifest;
  assert.ok(Array.isArray(departments) && Array.isArray(manifest), 'PATCH_OMISSION_ARTIFACT_INVALID');
  const patchRows = departments.filter(row => row.patch_url != null && row.patch_url !== '');
  const patchObjects = manifest.filter(object => object.sourceBucket === 'department-assets');
  assert.equal(patchRows.length, allowed.length, 'PATCH_OMISSION_REFERENCE_COUNT_CHANGED');
  assert.equal(patchObjects.length, allowed.length, 'PATCH_OMISSION_OBJECT_COUNT_CHANGED');
  assert.deepEqual(patchRows.map(row => String(row.id)).sort(), [...allowed].sort(),
    'PATCH_OMISSION_DEPARTMENT_SET_CHANGED');
  const byKey = new Map(patchObjects.map(object => [object.sourceKey, object]));
  assert.equal(byKey.size, patchObjects.length, 'PATCH_OMISSION_OBJECT_DUPLICATE');
  const omitted = patchRows.map(row => {
    assert.equal(typeof row.patch_url, 'string', 'PATCH_OMISSION_REFERENCE_INVALID');
    let url;
    try { url = new URL(row.patch_url); }
    catch { throw new Error('PATCH_OMISSION_REFERENCE_INVALID'); }
    assert.equal(url.origin, `https://${sourceProjectRef}.supabase.co`, 'PATCH_OMISSION_ORIGIN_MISMATCH');
    assert.equal(url.search, '', 'PATCH_OMISSION_QUERY_UNEXPECTED');
    assert.equal(url.hash, '', 'PATCH_OMISSION_FRAGMENT_UNEXPECTED');
    const prefix = '/storage/v1/object/public/department-assets/';
    assert.ok(url.pathname.startsWith(prefix), 'PATCH_OMISSION_BUCKET_MISMATCH');
    const key = decodeURIComponent(url.pathname.slice(prefix.length));
    assert.equal(key, EXPECTED_KEYS[sourceProjectRef][row.id],
      'PATCH_OMISSION_ASSET_NOT_APPROVED');
    assert.ok(key.startsWith(`${row.id}/`) && key.split('/').every(part => part && part !== '.' && part !== '..'),
      'PATCH_OMISSION_TENANT_KEY_MISMATCH');
    const object = byKey.get(key);
    assert.ok(object, 'PATCH_OMISSION_OBJECT_NOT_IN_MANIFEST');
    assert.equal(object.departmentId, row.id, 'PATCH_OMISSION_OBJECT_OWNER_MISMATCH');
    assert.equal(object.destinationKey, `department-assets/${key}`, 'PATCH_OMISSION_DESTINATION_MISMATCH');
    assert.equal(typeof object.sha256, 'string', 'PATCH_OMISSION_OBJECT_HASH_MISSING');
    return Object.freeze({ departmentId: row.id, priorSourceReference: row.patch_url,
      sourceBucket: object.sourceBucket, sourceKey: key, destinationKey: object.destinationKey,
      bytes: object.bytes, sha256: object.sha256 });
  });
  assert.equal(new Set(omitted.map(item => item.sourceKey)).size, allowed.length,
    'PATCH_OMISSION_OBJECT_MAPPING_DUPLICATE');
  const projectedDepartments = departments.map(row => allowed.includes(String(row.id))
    ? { ...row, patch_url: null } : row);
  const inScopeManifest = manifest.filter(object => object.sourceBucket !== 'department-assets');
  const evidence = { rule: 'owner-approved-agency-patch-omission-v1', changed: allowed.length,
    sourceCanonicalSha256: canonicalRowsHash(departments),
    normalizedCanonicalSha256: canonicalRowsHash(projectedDepartments),
    stableDepartmentIdHashes: allowed.map(sha256).sort() };
  return { originalDepartmentRows: departments, projectedDepartments,
    inScopeManifest, omitted, evidence };
}

export async function verifyOmittedAgencyPatches(client, artifact, sourceProjectRef) {
  const projection = projectOmittedAgencyPatches(artifact, sourceProjectRef);
  const rows = (await client.query(`select id::text,patch_url from public.${quote('departments')} order by id`)).rows;
  assert.equal(rows.length, artifact.rows.departments.length, 'PATCH_OMISSION_TARGET_DEPARTMENT_COUNT');
  const byId = new Map(rows.map(row => [String(row.id), row]));
  assert.equal(byId.size, rows.length, 'PATCH_OMISSION_TARGET_DEPARTMENT_DUPLICATE');
  for (const source of artifact.rows.departments) {
    const target = byId.get(String(source.id));
    assert.ok(target, 'PATCH_OMISSION_TARGET_DEPARTMENT_MISSING');
    if (projection.omitted.some(item => item.departmentId === source.id))
      assert.equal(target.patch_url, null, 'PATCH_OMISSION_DANGLING_TARGET_REFERENCE');
    else assert.equal(target.patch_url, source.patch_url, 'PATCH_OMISSION_UNRELATED_REFERENCE_CHANGED');
  }
  return projection;
}

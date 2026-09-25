import assert from 'node:assert/strict';
import test from 'node:test';
import { MIGRATION_RELATIONS } from './supabase-rest-ledger-core.mjs';
import {
  SOURCE_ORIGIN, attestFrozen, buildArtifact, classifyStorageEntry, objectPath,
  relationUrl, sourceRequest, validateCaptureEnvironment,
} from './source-rehearsal-final-capture-core.mjs';

test('capture is pinned to the paid source, exact AWS account, and one immutable key', () => {
  const env = { TRACEPOINT_SOURCE_REHEARSAL_PROJECT_REF: 'reukdouvpshshvqnzsgw', TRACEPOINT_EXPECTED_AWS_ACCOUNT: '193644343389',
    TRACEPOINT_SOURCE_REHEARSAL_RUN_ID: '00000000-0000-4000-8000-000000000001', SOURCE_REHEARSAL_SECRET_KEY: `sb_secret_${'x'.repeat(24)}` };
  assert.equal(validateCaptureEnvironment(env).key, 'migration/source-rehearsal/00000000-0000-4000-8000-000000000001/final-canonical.json');
  assert.throws(() => validateCaptureEnvironment({ ...env, TRACEPOINT_SOURCE_REHEARSAL_PROJECT_REF: 'izlkwggluhlhzlumtzes' }));
  assert.throws(() => validateCaptureEnvironment({ ...env, TRACEPOINT_EXPECTED_AWS_ACCOUNT: '265544358665' }));
  assert.throws(() => validateCaptureEnvironment({ ...env, TRACEPOINT_SOURCE_REHEARSAL_RUN_ID: '../latest' }));
});

test('only hardcoded source read paths are permitted', () => {
  assert.equal(sourceRequest('GET', relationUrl('departments', 0)).origin, SOURCE_ORIGIN);
  assert.equal(objectPath('department-assets', 'tenant/patch.png'), `${SOURCE_ORIGIN}/storage/v1/object/authenticated/department-assets/tenant/patch.png`);
  assert.equal(sourceRequest('GET', objectPath('department-assets', 'tenant/patch.png')).origin, SOURCE_ORIGIN);
  assert.throws(() => sourceRequest('GET', `${SOURCE_ORIGIN}/storage/v1/object/public/department-assets/tenant/patch.png`));
  assert.doesNotThrow(() => sourceRequest('POST', `${SOURCE_ORIGIN}/rest/v1/rpc/tracepoint_source_rehearsal_fence_status`));
  assert.doesNotThrow(() => sourceRequest('POST', `${SOURCE_ORIGIN}/storage/v1/object/list/department-assets`));
  assert.throws(() => sourceRequest('POST', `${SOURCE_ORIGIN}/rest/v1/departments`));
  assert.throws(() => sourceRequest('DELETE', `${SOURCE_ORIGIN}/rest/v1/departments`));
  assert.throws(() => sourceRequest('GET', 'https://izlkwggluhlhzlumtzes.supabase.co/rest/v1/departments'));
  assert.throws(() => relationUrl('unexpected_table', 0));
  assert.throws(() => objectPath('other-bucket', 'patch.png'));
  assert.throws(() => objectPath('department-assets', '../patch.png'));
});

test('Storage listing is traversed without treating folders as objects', () => {
  assert.deepEqual(classifyStorageEntry('', { name: 'tenant', id: null }), { kind: 'folder', prefix: 'tenant/' });
  assert.deepEqual(classifyStorageEntry('tenant/', { name: 'patch.png', id: 'object-id' }), { kind: 'object', key: 'tenant/patch.png' });
  assert.throws(() => classifyStorageEntry('', { name: '../escape', id: 'object-id' }));
});

test('capture fails closed unless the fence is active and stable', () => {
  assert.equal(attestFrozen({ frozen: true, changed_at: '2026-09-25T02:00:00.000000Z', database: 'postgres' }), '2026-09-25T02:00:00.000000Z');
  assert.throws(() => attestFrozen({ frozen: false, changed_at: '2026-09-25T02:00:00Z', database: 'postgres' }), /NOT_ACTIVE/);
  assert.throws(() => attestFrozen({ frozen: true, changed_at: '2026-09-25T02:00:00Z', database: 'other' }));
});

test('artifact retains complete reviewed relations and both integrity domains', () => {
  const rowsByRelation = new Map(MIGRATION_RELATIONS.map(relation => [relation, []]));
  rowsByRelation.set('departments', [{ id: 'synthetic-id' }]);
  const artifact = buildArtifact({ runId: '00000000-0000-4000-8000-000000000001', capturedAtUtc: '2026-09-25T02:00:00Z',
    fenceChangedAt: '2026-09-25T01:59:00Z', rowsByRelation, identities: [{ id: 'synthetic-user' }], objects: [] });
  assert.equal(artifact.body.tables.length, MIGRATION_RELATIONS.length);
  assert.equal(artifact.body.totalRelationalRows, 1);
  assert.match(artifact.masterSha256, /^[0-9a-f]{64}$/);
  assert.match(artifact.byteSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(artifact.masterSha256, artifact.byteSha256);
  assert.throws(() => buildArtifact({ runId: '00000000-0000-4000-8000-000000000001', capturedAtUtc: '2026-09-25T02:00:00Z',
    fenceChangedAt: '2026-09-25T01:59:00Z', rowsByRelation: new Map([['departments', []]]), identities: [], objects: [] }));
});

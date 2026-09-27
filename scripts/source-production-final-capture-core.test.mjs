import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIGRATION_RELATIONS } from './supabase-rest-ledger-core.mjs';
import { SOURCE_ORIGIN, attestCompositeEvidence, attestFrozen, buildArtifact, relationUrl, sourceRequest,
  validateCaptureEnvironment } from './source-production-final-capture-core.mjs';

const runId = '1d761bd7-04dd-43f3-b77a-2c41130e18c2';
const valid = { TRACEPOINT_SOURCE_PRODUCTION_PROJECT_REF: 'izlkwggluhlhzlumtzes',
  TRACEPOINT_EXPECTED_AWS_ACCOUNT: '193644343389', TRACEPOINT_SOURCE_PRODUCTION_RUN_ID: runId,
  TRACEPOINT_SOURCE_PRODUCTION_CAPTURE_SLOT: 'A',
  SOURCE_PRODUCTION_PROJECT_URL: SOURCE_ORIGIN,
  SOURCE_PRODUCTION_SERVICE_KEY: `sb_secret_${'a'.repeat(25)}` };

test('production capture pins project, account, credential origin, and immutable key', () => {
  assert.equal(validateCaptureEnvironment(valid).key, `migration/source/${runId}/final-canonical.json`);
  assert.equal(validateCaptureEnvironment({ ...valid, TRACEPOINT_SOURCE_PRODUCTION_CAPTURE_SLOT: 'B',
    TRACEPOINT_SOURCE_PRODUCTION_RUN_ID: 'c7448ea9-4645-4e99-b988-3a05de12ac70' }).slot, 'B');
  for (const patch of [
    { TRACEPOINT_SOURCE_PRODUCTION_PROJECT_REF: 'reukdouvpshshvqnzsgw' },
    { TRACEPOINT_SOURCE_PRODUCTION_PROJECT_REF: 'wztqqqashilusoppddxi' },
    { SOURCE_PRODUCTION_PROJECT_URL: 'https://reukdouvpshshvqnzsgw.supabase.co' },
    { TRACEPOINT_EXPECTED_AWS_ACCOUNT: '265544358665' },
    { TRACEPOINT_SOURCE_PRODUCTION_RUN_ID: '00000000-0000-4000-8000-000000000001' },
    { TRACEPOINT_SOURCE_PRODUCTION_CAPTURE_SLOT: 'B' },
    { SOURCE_PRODUCTION_SERVICE_KEY: '' },
  ]) assert.throws(() => validateCaptureEnvironment({ ...valid, ...patch }));
});

test('capture requests reject rehearsal, staging, mutations, and arbitrary RPCs', () => {
  assert.doesNotThrow(() => sourceRequest('GET', relationUrl('departments', 0)));
  assert.doesNotThrow(() => sourceRequest('POST', `${SOURCE_ORIGIN}/rest/v1/rpc/tracepoint_source_production_fence_status`));
  for (const url of ['https://reukdouvpshshvqnzsgw.supabase.co/rest/v1/departments',
    'https://wztqqqashilusoppddxi.supabase.co/rest/v1/departments',
    `${SOURCE_ORIGIN}/rest/v1/rpc/arbitrary_write`]) assert.throws(() => sourceRequest('GET', url));
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'])
    assert.throws(() => sourceRequest(method, `${SOURCE_ORIGIN}/rest/v1/departments`));
});

test('capture requires stable public trigger and dispatcher state', () => {
  const state = { frozen: true, database: 'postgres', changed_at: '2026-09-27T12:00:00Z',
    relation_count: 122, public_trigger_count: 174, dispatcher_paused: true };
  assert.equal(attestFrozen(state), state.changed_at);
  for (const patch of [{ frozen: false }, { relation_count: 124 }, { public_trigger_count: 0 },
    { dispatcher_paused: false },
    { changed_at: null }, { database: 'tracepoint' }]) assert.throws(() => attestFrozen({ ...state, ...patch }));
});

test('capture rejects incomplete, stale, or cross-project composite attestations', () => {
  const fenceChangedAt = '2026-09-27T12:00:00Z';
  const families = ['applicationApi', 'serviceRole', 'authApi', 'storageApi', 'background', 'scheduledImportAdmin'];
  const evidence = { format: 'tracepoint-production-composite-fence/v1', projectRef: 'izlkwggluhlhzlumtzes',
    relationFingerprint: '36558b0730e3e96cad6426f38088a5b0', fenceChangedAt,
    maintenance503: true, publicTriggers: 174,
    s3WriterCredentials: 'NO_SEPARATE_S3_WRITER_CREDENTIALS', observedAtUtc: '2026-09-27T12:01:00Z',
    writers: Object.fromEntries(families.map(name => [name, { blocked: true,
      directNegativePassed: true, reversibleControl: 'reviewed inverse',
      negativeEvidenceSha256: 'a'.repeat(64), restoreProcedureSha256: 'b'.repeat(64) }])) };
  const now = Date.parse('2026-09-27T12:02:00Z');
  assert.equal(attestCompositeEvidence(evidence, fenceChangedAt, now), true);
  for (const patch of [{ projectRef: 'reukdouvpshshvqnzsgw' }, { publicTriggers: 244 },
    { maintenance503: false }, { observedAtUtc: '2026-09-27T11:50:00Z' },
    { writers: { ...evidence.writers, authApi: { ...evidence.writers.authApi, directNegativePassed: false } } }])
    assert.throws(() => attestCompositeEvidence({ ...evidence, ...patch }, fenceChangedAt, now));
});

test('artifact is production-labelled and includes all reviewed relation contracts', () => {
  const rowsByRelation = new Map(MIGRATION_RELATIONS.map(name => [name, []]));
  const result = buildArtifact({ runId, capturedAtUtc: '2026-09-27T12:00:01Z',
    fenceChangedAt: '2026-09-27T12:00:00Z', rowsByRelation, identities: [], objects: [] });
  assert.equal(result.body.source.projectRef, 'izlkwggluhlhzlumtzes');
  assert.equal(result.body.tables.length, MIGRATION_RELATIONS.length);
  assert.equal(result.body.authorizationReference, 'TP-PRODUCTION-FINAL-SOURCE-20260927');
  assert.throws(() => buildArtifact({ runId, capturedAtUtc: '2026-09-27T12:00:01Z',
    fenceChangedAt: '2026-09-27T12:00:00Z', rowsByRelation: new Map(), identities: [], objects: [] }));
});

test('buildspec pins only the production REST secret and does not weaken the rehearsal buildspec', () => {
  const production = readFileSync(new URL('../buildspec.source-production-final-capture.yml', import.meta.url), 'utf8');
  const rehearsal = readFileSync(new URL('../buildspec.source-rehearsal-capture.yml', import.meta.url), 'utf8');
  assert.match(production, /source-supabase-rest-wvh4pi:serviceRoleKey/);
  assert.match(production, /izlkwggluhlhzlumtzes/);
  assert.match(readFileSync(new URL('../infra/changesets/production-source-capture-20260927/template.yml', import.meta.url), 'utf8'),
    /1d761bd7-04dd-43f3-b77a-2c41130e18c2/);
  assert.doesNotMatch(production, /source-rehearsal-only|reukdouvpshshvqnzsgw|wztqqqashilusoppddxi/);
  assert.match(rehearsal, /reukdouvpshshvqnzsgw/);
  const compareBuild = readFileSync(new URL('../buildspec.source-production-double-compare.yml', import.meta.url), 'utf8');
  assert.match(compareBuild, /compare-frozen-source-captures\.mjs/);
  assert.match(compareBuild, /--minimum-quiet-seconds 60/);
  assert.doesNotMatch(compareBuild, /SOURCE_PRODUCTION_SERVICE_KEY|secrets-manager:/);
  const comparator = readFileSync(new URL('./compare-frozen-source-captures.mjs', import.meta.url), 'utf8');
  assert.match(comparator, /PRODUCTION_CAPTURE_A_KEY_MISMATCH/);
  assert.match(comparator, /PRODUCTION_CAPTURE_B_KEY_MISMATCH/);
  assert.match(comparator, /selectedFinalArtifact: project === 'izlkwggluhlhzlumtzes' \? second : null/);
});

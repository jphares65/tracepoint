import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIGRATION_RELATIONS } from './supabase-rest-ledger-core.mjs';
import { SOURCE_ORIGIN, attestFrozen, buildArtifact, relationUrl, sourceRequest,
  validateCaptureEnvironment } from './source-production-final-capture-core.mjs';

const runId = '0762cf3d-5f8e-4e89-afa0-051a39e4dce7';
const valid = { TRACEPOINT_SOURCE_PRODUCTION_PROJECT_REF: 'izlkwggluhlhzlumtzes',
  TRACEPOINT_EXPECTED_AWS_ACCOUNT: '193644343389', TRACEPOINT_SOURCE_PRODUCTION_RUN_ID: runId,
  SOURCE_PRODUCTION_PROJECT_URL: SOURCE_ORIGIN,
  SOURCE_PRODUCTION_SERVICE_KEY: `sb_secret_${'a'.repeat(25)}` };

test('production capture pins project, account, credential origin, and immutable key', () => {
  assert.equal(validateCaptureEnvironment(valid).key, `migration/source/${runId}/final-canonical.json`);
  for (const patch of [
    { TRACEPOINT_SOURCE_PRODUCTION_PROJECT_REF: 'reukdouvpshshvqnzsgw' },
    { TRACEPOINT_SOURCE_PRODUCTION_PROJECT_REF: 'wztqqqashilusoppddxi' },
    { SOURCE_PRODUCTION_PROJECT_URL: 'https://reukdouvpshshvqnzsgw.supabase.co' },
    { TRACEPOINT_EXPECTED_AWS_ACCOUNT: '265544358665' },
    { TRACEPOINT_SOURCE_PRODUCTION_RUN_ID: '00000000-0000-4000-8000-000000000001' },
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

test('capture requires a stable, complete 122-relation/244-trigger production fence', () => {
  const state = { frozen: true, database: 'postgres', changed_at: '2026-09-27T12:00:00Z',
    relation_count: 122, trigger_count: 244 };
  assert.equal(attestFrozen(state), state.changed_at);
  for (const patch of [{ frozen: false }, { relation_count: 124 }, { trigger_count: 0 },
    { changed_at: null }, { database: 'tracepoint' }]) assert.throws(() => attestFrozen({ ...state, ...patch }));
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
    /0762cf3d-5f8e-4e89-afa0-051a39e4dce7/);
  assert.doesNotMatch(production, /source-rehearsal-only|reukdouvpshshvqnzsgw|wztqqqashilusoppddxi/);
  assert.match(rehearsal, /reukdouvpshshvqnzsgw/);
});

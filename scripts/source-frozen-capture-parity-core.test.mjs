import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIGRATION_RELATIONS } from './supabase-rest-ledger-core.mjs';
import { buildArtifact } from './source-rehearsal-final-capture-core.mjs';
import { compareFrozenCaptures, parseAndVerifyArtifact } from './source-frozen-capture-parity-core.mjs';

const project = 'reukdouvpshshvqnzsgw';
const fenceChangedAt = '2026-09-27T12:00:00.000Z';

function artifact(runId, capturedAtUtc, overrides = {}) {
  const rowsByRelation = new Map(MIGRATION_RELATIONS.map(name => [name, []]));
  for (const [relation, rows] of Object.entries(overrides.rows ?? {})) rowsByRelation.set(relation, rows);
  const created = buildArtifact({ runId, capturedAtUtc, fenceChangedAt: overrides.fenceChangedAt ?? fenceChangedAt,
    rowsByRelation, identities: overrides.identities ?? [], objects: overrides.objects ?? [] });
  return { ...created, parsed: JSON.parse(created.payload) };
}

const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';

test('distinct immutable captures with no authoritative delta pass a bounded quiet window', () => {
  const first = artifact(firstId, '2026-09-27T12:01:00.000Z');
  const second = artifact(secondId, '2026-09-27T12:03:00.000Z');
  const verifiedFirst = parseAndVerifyArtifact(Buffer.from(first.payload), first.byteSha256, project);
  const verifiedSecond = parseAndVerifyArtifact(Buffer.from(second.payload), second.byteSha256, project);
  const result = compareFrozenCaptures(verifiedFirst, verifiedSecond, project, 60_000);
  assert.equal(result.status, 'FROZEN_SOURCE_QUIESCENT');
  assert.equal(result.quietMs, 120_000);
  assert.deepEqual(result.changedRelations, []);
});

test('relational, Auth, and Storage changes each fail quiescence', () => {
  const first = artifact(firstId, '2026-09-27T12:01:00.000Z').parsed;
  const changed = [
    artifact(secondId, '2026-09-27T12:03:00.000Z', { rows: { departments: [{ id: 'synthetic' }] } }).parsed,
    artifact(secondId, '2026-09-27T12:03:00.000Z', { identities: [{ id: 'synthetic' }] }).parsed,
    artifact(secondId, '2026-09-27T12:03:00.000Z', { objects: [{ sourceBucket: 'department-assets', sourceKey: 'synthetic', destinationKey: 'department-assets/synthetic', bytes: 1, sha256: 'a'.repeat(64), contentType: 'image/png', departmentId: null }] }).parsed,
  ];
  for (const later of changed) assert.equal(compareFrozenCaptures(first, later, project).status, 'AUTHORITATIVE_DELTA_DETECTED');
});

test('changed fence, insufficient interval, same run and wrong project fail closed', () => {
  const first = artifact(firstId, '2026-09-27T12:01:00.000Z').parsed;
  assert.throws(() => compareFrozenCaptures(first, artifact(secondId, '2026-09-27T12:01:30.000Z').parsed, project), /QUIET_WINDOW_TOO_SHORT/);
  assert.throws(() => compareFrozenCaptures(first, artifact(firstId, '2026-09-27T12:03:00.000Z').parsed, project), /CAPTURE_RUNS_NOT_DISTINCT/);
  assert.throws(() => compareFrozenCaptures(first, artifact(secondId, '2026-09-27T12:03:00.000Z', { fenceChangedAt: '2026-09-27T12:02:00.000Z' }).parsed, project), /FENCE_CHANGED_BETWEEN_CAPTURES/);
  assert.throws(() => compareFrozenCaptures(first, artifact(secondId, '2026-09-27T12:03:00.000Z').parsed, 'izlkwggluhlhzlumtzes'), /SOURCE_PROJECT_MISMATCH/);
});

test('byte tamper and forged inner hash fail before comparison', () => {
  const first = artifact(firstId, '2026-09-27T12:01:00.000Z');
  assert.throws(() => parseAndVerifyArtifact(Buffer.from(first.payload + ' '), first.byteSha256, project), /ARTIFACT_BYTE_HASH_MISMATCH/);
  const changed = structuredClone(first.parsed);
  changed.rows.departments.push({ id: 'synthetic' });
  assert.throws(() => compareFrozenCaptures(changed, artifact(secondId, '2026-09-27T12:03:00.000Z').parsed, project), /TABLE_ROW_COUNT_MISMATCH/);
});

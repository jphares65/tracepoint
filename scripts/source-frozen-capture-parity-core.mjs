import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MIGRATION_RELATIONS, canonical, sha256 } from './supabase-rest-ledger-core.mjs';

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const PROJECTS = new Set(['reukdouvpshshvqnzsgw', 'izlkwggluhlhzlumtzes']);

function verifiedArtifact(artifact, expectedProject) {
  assert.ok(PROJECTS.has(expectedProject), 'UNAPPROVED_SOURCE_PROJECT');
  assert.equal(artifact?.format, 'tracepoint-immutable-source-artifact/v1', 'ARTIFACT_FORMAT_MISMATCH');
  assert.equal(artifact?.source?.projectRef, expectedProject, 'SOURCE_PROJECT_MISMATCH');
  assert.equal(artifact?.source?.projectUrl, `https://${expectedProject}.supabase.co`, 'SOURCE_ORIGIN_MISMATCH');
  assert.equal(artifact?.source?.provider, 'supabase-rest-admin', 'SOURCE_PROVIDER_MISMATCH');
  assert.equal(artifact?.source?.database, undefined, 'UNREVIEWED_ARTIFACT_EXTENSION');
  assert.ok(Number.isFinite(Date.parse(artifact?.source?.fenceChangedAt)), 'FENCE_TIMESTAMP_MISSING');
  assert.ok(Number.isFinite(Date.parse(artifact?.capturedAtUtc)), 'CAPTURE_TIMESTAMP_MISSING');
  assert.deepEqual(artifact?.source?.relationContract, [...MIGRATION_RELATIONS], 'RELATION_CONTRACT_MISMATCH');
  assert.deepEqual(artifact?.tables?.map(table => table.name), [...MIGRATION_RELATIONS], 'TABLE_SET_MISMATCH');
  assert.equal(artifact?.tables?.length, 90, 'TABLE_COUNT_MISMATCH');
  assert.ok(artifact?.rows && typeof artifact.rows === 'object', 'ROWS_MISSING');
  for (const table of artifact.tables) {
    assert.ok(Number.isSafeInteger(table.rows) && table.rows >= 0, 'INVALID_ROW_COUNT');
    assert.match(table.canonicalDataSha256 ?? '', HEX_SHA256, 'INVALID_TABLE_HASH');
    assert.ok(Array.isArray(artifact.rows[table.name]), 'TABLE_ROWS_MISSING');
    assert.equal(artifact.rows[table.name].length, table.rows, 'TABLE_ROW_COUNT_MISMATCH');
    assert.equal(sha256(artifact.rows[table.name]), table.canonicalDataSha256, 'TABLE_HASH_MISMATCH');
  }
  assert.equal(artifact.totalRelationalRows, artifact.tables.reduce((sum, table) => sum + table.rows, 0), 'TOTAL_ROW_COUNT_MISMATCH');
  assert.ok(Array.isArray(artifact?.identities?.rows), 'IDENTITIES_MISSING');
  assert.equal(artifact.identities.rows.length, artifact.identities.count, 'IDENTITY_COUNT_MISMATCH');
  assert.equal(sha256(artifact.identities.rows), artifact.identities.canonicalDataSha256, 'IDENTITY_HASH_MISMATCH');
  const memberships = artifact.rows.department_memberships;
  assert.equal(memberships.length, artifact?.memberships?.count, 'MEMBERSHIP_COUNT_MISMATCH');
  assert.equal(sha256(memberships), artifact.memberships.canonicalDataSha256, 'MEMBERSHIP_HASH_MISMATCH');
  assert.ok(Array.isArray(artifact?.objects?.manifest), 'OBJECT_MANIFEST_MISSING');
  assert.equal(artifact.objects.manifest.length, artifact.objects.count, 'OBJECT_COUNT_MISMATCH');
  assert.equal(sha256(artifact.objects.manifest), artifact.objects.manifestSha256, 'OBJECT_MANIFEST_HASH_MISMATCH');
  assert.equal(artifact.objects.totalBytes, artifact.objects.manifest.reduce((sum, item) => sum + item.bytes, 0), 'OBJECT_BYTES_MISMATCH');
  for (const object of artifact.objects.manifest) {
    assert.match(object.sha256 ?? '', HEX_SHA256, 'OBJECT_CONTENT_HASH_MISSING');
    assert.ok(Number.isSafeInteger(object.bytes) && object.bytes >= 0, 'OBJECT_SIZE_INVALID');
  }
  const { masterSha256, ...body } = artifact;
  assert.equal(sha256(body), masterSha256, 'MASTER_HASH_MISMATCH');
  return artifact;
}

export function compareFrozenCaptures(first, second, expectedProject, minimumQuietMs = 60_000) {
  verifiedArtifact(first, expectedProject);
  verifiedArtifact(second, expectedProject);
  assert.notEqual(first.runId, second.runId, 'CAPTURE_RUNS_NOT_DISTINCT');
  assert.equal(first.source.fenceChangedAt, second.source.fenceChangedAt, 'FENCE_CHANGED_BETWEEN_CAPTURES');
  const quietMs = Date.parse(second.capturedAtUtc) - Date.parse(first.capturedAtUtc);
  assert.ok(Number.isSafeInteger(minimumQuietMs) && minimumQuietMs > 0, 'INVALID_QUIET_WINDOW');
  assert.ok(quietMs >= minimumQuietMs, 'QUIET_WINDOW_TOO_SHORT');

  const changedRelations = first.tables.flatMap((table, index) => {
    const later = second.tables[index];
    return table.rows === later.rows && table.canonicalDataSha256 === later.canonicalDataSha256 ? [] : [table.name];
  });
  const identityChanged = first.identities.count !== second.identities.count
    || first.identities.canonicalDataSha256 !== second.identities.canonicalDataSha256;
  const membershipsChanged = first.memberships.count !== second.memberships.count
    || first.memberships.canonicalDataSha256 !== second.memberships.canonicalDataSha256;
  const objectsChanged = first.objects.count !== second.objects.count
    || first.objects.totalBytes !== second.objects.totalBytes
    || first.objects.manifestSha256 !== second.objects.manifestSha256;
  return {
    status: changedRelations.length || identityChanged || membershipsChanged || objectsChanged
      ? 'AUTHORITATIVE_DELTA_DETECTED' : 'FROZEN_SOURCE_QUIESCENT',
    sourceProjectRef: expectedProject,
    quietMs,
    changedRelations,
    identityChanged,
    membershipsChanged,
    objectsChanged,
    relationContracts: first.tables.length,
    firstRows: first.totalRelationalRows,
    secondRows: second.totalRelationalRows,
    firstIdentities: first.identities.count,
    secondIdentities: second.identities.count,
    firstObjects: first.objects.count,
    secondObjects: second.objects.count,
  };
}

export function parseAndVerifyArtifact(bytes, expectedByteSha256, expectedProject) {
  assert.match(expectedByteSha256 ?? '', HEX_SHA256, 'EXPECTED_BYTE_HASH_MISSING');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedByteSha256, 'ARTIFACT_BYTE_HASH_MISMATCH');
  const artifact = JSON.parse(Buffer.from(bytes).toString('utf8'));
  assert.equal(canonical(artifact), Buffer.from(bytes).toString('utf8'), 'NONCANONICAL_ARTIFACT_BYTES');
  return verifiedArtifact(artifact, expectedProject);
}

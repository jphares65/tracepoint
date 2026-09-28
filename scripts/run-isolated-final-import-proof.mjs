#!/usr/bin/env node
// Synthetic paid-source A/B import proof. This cannot target final or public RDS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { S3Client } from '@aws-sdk/client-s3';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { validateImmutableArtifact } from './immutable-source-artifact-validator.mjs';
import { loadPinnedCapture } from './run-production-final-atomic-import.mjs';
import { compareFrozenCaptures, parseAndVerifyArtifact } from './source-frozen-capture-parity-core.mjs';
import { runAttestedAtomicImport } from './production-final-atomic-import-core.mjs';
import { finalImportOperations } from './production-final-relation-adapter.mjs';

const ACCOUNT = '193644343389';
const REGION = 'us-east-1';
const PAID_PROJECT = 'reukdouvpshshvqnzsgw';
const BUCKET = 'tracepoint-production-private-193644343389';
const INSTANCE = 'tracepoint-production-final-import-proof-20260928';
const HOST = /^tracepoint-production-final-import-proof-20260928\.[a-z0-9]+\.us-east-1\.rds\.amazonaws\.com$/;
const CAPTURES = Object.freeze({
  A: { runId: '463606ba-ce48-468d-a91c-57c8067a0d3b',
    versionId: 'tbPTk63hnk56bzp_cw94l5AnHxhbK7pK',
    byteSha256: '8d8eef632cd44228e775a785f08673d092a4aa6c0a8c6c06afebf0d2b99df59c' },
  B: { runId: '90e721c1-039b-47f8-b02d-c4e79d6100c8',
    versionId: 'dy89s6SJfQ6CI1jeLqQijuYqOexbv5OU',
    byteSha256: 'ad66795b903368a0c33f93a5a3646ac407845c2203748d704f406c48917bc729' },
});

export function validateIsolatedProofEnvironment(env) {
  assert.equal(env.TRACEPOINT_ISOLATED_IMPORT_PROOF, 'paid-capture-b-to-proof-rds-v1',
    'ISOLATED_PROOF_GUARD_REQUIRED');
  assert.ok(['baseline', 'rollback', 'apply'].includes(env.TRACEPOINT_ISOLATED_IMPORT_MODE),
    'ISOLATED_PROOF_MODE_REQUIRED');
  assert.equal(env.TRACEPOINT_EXPECTED_AWS_ACCOUNT, ACCOUNT, 'ISOLATED_PROOF_ACCOUNT_REQUIRED');
  assert.equal(env.TRACEPOINT_EXPECTED_AWS_REGION, REGION, 'ISOLATED_PROOF_REGION_REQUIRED');
  assert.match(env.TRACEPOINT_PROOF_RDS_HOST ?? '', HOST, 'ISOLATED_PROOF_HOST_REQUIRED');
  assert.match(env.TRACEPOINT_PROOF_RDS_RESOURCE_ID ?? '', /^db-[A-Z0-9]+$/,
    'ISOLATED_PROOF_RESOURCE_REQUIRED');
  const secret = JSON.parse(env.TARGET_DATABASE_SECRET_JSON ?? 'null');
  assert.equal(secret?.dbname, 'tracepoint', 'ISOLATED_PROOF_DATABASE_REQUIRED');
  assert.equal(Number(secret?.port), 5432, 'ISOLATED_PROOF_PORT_REQUIRED');
  assert.ok(secret?.username && secret?.password, 'ISOLATED_PROOF_SECRET_REQUIRED');
  // The cloned snapshot shares the migrator password; the stored secret itself
  // remains pinned to final RDS and must never be rewritten for this proof.
  assert.ok(new Set([
    'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com',
    'tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com',
  ]).has(secret?.host), 'ISOLATED_PROOF_SECRET_SOURCE_MISMATCH');
  return { host: env.TRACEPOINT_PROOF_RDS_HOST,
    resourceId: env.TRACEPOINT_PROOF_RDS_RESOURCE_ID,
    mode: env.TRACEPOINT_ISOLATED_IMPORT_MODE, secret };
}

function pinnedSpec(slot) {
  const capture = CAPTURES[slot];
  return { bucket: BUCKET,
    key: `migration/source-rehearsal/${capture.runId}/final-canonical.json`,
    versionId: capture.versionId, byteSha256: capture.byteSha256 };
}

export async function runIsolatedFinalImportProof(env = process.env, services = {}) {
  let stage = 'environment';
  const { host, resourceId, mode, secret } = validateIsolatedProofEnvironment(env);
  delete env.TARGET_DATABASE_SECRET_JSON;
  const s3 = services.s3 ?? new S3Client({ region: REGION, maxAttempts: 2 });
  const rds = services.rds ?? new RDSClient({ region: REGION, maxAttempts: 2 });
  let client;
  try {
    stage = 'artifact-and-target-fetch';
    const [firstSpec, secondSpec, response] = await Promise.all([
      loadPinnedCapture(s3, pinnedSpec('A')),
      loadPinnedCapture(s3, pinnedSpec('B')),
      rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: INSTANCE })),
    ]);
    const target = response.DBInstances?.[0];
    stage = 'target-attestation';
    assert.equal(target?.DBInstanceIdentifier, INSTANCE, 'ISOLATED_PROOF_INSTANCE_MISMATCH');
    assert.equal(target?.DbiResourceId, resourceId, 'ISOLATED_PROOF_RESOURCE_MISMATCH');
    assert.equal(target?.Endpoint?.Address, host, 'ISOLATED_PROOF_ENDPOINT_MISMATCH');
    assert.equal(target?.Endpoint?.Port, 5432, 'ISOLATED_PROOF_ENDPOINT_PORT_MISMATCH');
    assert.equal(target?.DBName, 'tracepoint', 'ISOLATED_PROOF_DATABASE_MISMATCH');
    assert.equal(target?.DBInstanceStatus, 'available', 'ISOLATED_PROOF_TARGET_UNAVAILABLE');
    assert.equal(target?.PubliclyAccessible, false, 'ISOLATED_PROOF_TARGET_PUBLIC');
    assert.equal(target?.StorageEncrypted, true, 'ISOLATED_PROOF_TARGET_UNENCRYPTED');
    assert.equal(target?.DeletionProtection, true, 'ISOLATED_PROOF_TARGET_UNPROTECTED');
    assert.equal(target?.EngineVersion, '17.9', 'ISOLATED_PROOF_ENGINE_MISMATCH');
    stage = 'artifact-attestation';
    const a = parseAndVerifyArtifact(firstSpec.bytes, firstSpec.byteSha256, PAID_PROJECT);
    const b = parseAndVerifyArtifact(secondSpec.bytes, secondSpec.byteSha256, PAID_PROJECT);
    assert.equal(a.runId, CAPTURES.A.runId, 'ISOLATED_PROOF_A_RUN_MISMATCH');
    assert.equal(b.runId, CAPTURES.B.runId, 'ISOLATED_PROOF_B_RUN_MISMATCH');
    const parity = compareFrozenCaptures(a, b, PAID_PROJECT);
    assert.equal(parity.status, 'FROZEN_SOURCE_QUIESCENT', 'ISOLATED_PROOF_SOURCE_CHANGED');
    const expectations = { relationalRows: b.totalRelationalRows,
      identities: b.identities.count, memberships: b.memberships.count,
      activeMemberships: b.rows.department_memberships.filter(row => row.is_active === true).length,
      inactiveMemberships: b.rows.department_memberships.filter(row => row.is_active !== true).length,
      platformAdmins: b.rows.platform_admins.length,
      objects: b.objects.count, objectBytes: b.objects.totalBytes };
    validateImmutableArtifact(b, { expectedSha256: b.masterSha256,
      expectedRunId: CAPTURES.B.runId,
      expectedAuthorizationReference: 'TP-SOURCE-REHEARSAL-20260925', expectations });
    const plan = Object.freeze({ target: { resourceId }, parity,
      selectedArtifact: { versionId: secondSpec.versionId,
        byteSha256: secondSpec.byteSha256, masterSha256: b.masterSha256 },
      relationalRows: b.totalRelationalRows, identities: b.identities.count,
      memberships: b.memberships.count });
    const ca = await readFile(env.TRACEPOINT_RDS_CA_PATH ?? '/app/rds-ca.pem', 'utf8');
    assert.match(ca, /BEGIN CERTIFICATE/, 'ISOLATED_PROOF_CA_MISSING');
    stage = 'database-connect';
    client = services.client ?? new pg.Client({ host, port: 5432, database: 'tracepoint',
      user: secret.username, password: secret.password,
      ssl: { ca, rejectUnauthorized: true, servername: host },
      connectionTimeoutMillis: 15_000, statement_timeout: 60_000,
      application_name: 'tracepoint-isolated-final-import-proof' });
    await client.connect();
    const operations = finalImportOperations(resourceId);
    if (mode === 'baseline') {
      stage = 'baseline-read';
      const baseline = await operations.readBaseline(client);
      return { status: 'ISOLATED_IMPORT_PROOF_BASELINE', targetResourceId: resourceId,
        customerRows: baseline.customerRows, authUsers: baseline.authUsers,
        migrationLineage: baseline.migrationLineage, tlsRequired: true };
    }
    const reconcileInTransaction = mode === 'rollback'
      ? async (db, args) => { stage = 'reconcile-in-transaction'; await operations.reconcileInTransaction(db, args);
        throw new Error('ISOLATED_PROOF_FORCED_ROLLBACK'); }
      : async (db, args) => { stage = 'reconcile-in-transaction';
        return operations.reconcileInTransaction(db, args); };
    stage = 'atomic-import';
    const result = await runAttestedAtomicImport({ plan, artifact: b,
      expectedTargetResourceId: resourceId, client,
      ...operations,
      readBaseline: async db => { stage = 'atomic-baseline'; return operations.readBaseline(db); },
      applyRelations: async (db, args) => { stage = 'apply-relations';
        return operations.applyRelations(db, args); },
      reconcileInTransaction,
      verifyCommitted: async (db, args) => { stage = 'verify-committed';
        return operations.verifyCommitted(db, args); },
      verifyRollback: async (db, args) => { stage = 'verify-rollback';
        return operations.verifyRollback(db, args); } });
    assert.equal(mode, 'apply', 'ISOLATED_PROOF_ROLLBACK_UNEXPECTED_COMMIT');
    return { status: 'ISOLATED_IMPORT_PROOF_COMMITTED',
      sourceProjectRef: PAID_PROJECT, targetResourceId: resourceId,
      relationalRows: result.relationalRows, identities: result.identities,
      memberships: result.memberships, artifactVersionId: result.artifactVersionId };
  } catch (error) {
    error.proofStage = stage;
    throw error;
  } finally {
    await client?.end().catch(() => undefined);
    if (!services.s3) s3.destroy();
    if (!services.rds) rds.destroy();
  }
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await runIsolatedFinalImportProof())); }
  catch (error) {
    // Node AssertionError may append a multiline value diff to an explicit
    // assertion code. Emit only the allowlisted first line, never the diff.
    const firstLine = String(error?.message ?? '').split('\n', 1)[0];
    const code = /^[A-Z][A-Z0-9_:]*$/.test(firstLine) ? firstLine : 'ISOLATED_IMPORT_PROOF_FAILED';
    const type = /^[A-Za-z][A-Za-z0-9]*$/.test(String(error?.name)) ? error.name : 'Error';
    const sqlstate = /^[0-9A-Z]{5}$/.test(String(error?.code)) ? error.code : undefined;
    console.error(JSON.stringify({ status: 'BLOCKED', code,
      stage: error?.proofStage ?? 'environment',
      ...(typeof error?.importPhase === 'string' && /^[a-z-]+(?::[a-z_]+)?$/.test(error.importPhase)
        ? { importPhase: error.importPhase } : {}),
      ...(error?.contractDiff && Object.values(error.contractDiff).every(value =>
        Number.isSafeInteger(value) && value >= 0) ? { contractDiff: error.contractDiff } : {}),
      type, ...(sqlstate ? { sqlstate } : {}) }));
    process.exitCode = 1;
  }
}

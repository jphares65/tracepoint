#!/usr/bin/env node
// Exact-resource final relational importer. Never reads the live source or
// starts maintenance; intended only for an already-frozen A/B artifact pair.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { APPROVED_RUN_IDS, ARTIFACT_BUCKET, ARTIFACT_KMS_KEY_ARN } from './source-production-final-capture-core.mjs';
import { FINAL_RDS_HOST, FINAL_RDS_INSTANCE, FINAL_RDS_RESOURCE_ID } from './production-final-import-core.mjs';
import { runProductionFinalAtomicImport } from './production-final-atomic-import-core.mjs';
import { finalImportOperations } from './production-final-relation-adapter.mjs';

const ACCOUNT = '193644343389';
const REGION = 'us-east-1';
const SECRET_HOSTS = new Set([FINAL_RDS_HOST,
  'tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com']);
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^[A-Za-z0-9._-]+$/;

export function validateFinalImportEnvironment(env) {
  assert.equal(env.TRACEPOINT_FINAL_IMPORT_EXECUTE, 'capture-b-to-final-rds-v1', 'FINAL_IMPORT_EXECUTION_GUARD_REQUIRED');
  assert.equal(env.TRACEPOINT_EXPECTED_AWS_ACCOUNT, ACCOUNT, 'FINAL_IMPORT_ACCOUNT_REQUIRED');
  assert.equal(env.TRACEPOINT_EXPECTED_AWS_REGION, REGION, 'FINAL_IMPORT_REGION_REQUIRED');
  assert.equal(env.TRACEPOINT_TARGET_RESOURCE_ID, FINAL_RDS_RESOURCE_ID, 'FINAL_IMPORT_RESOURCE_REQUIRED');
  assert.equal(env.TARGET_PGHOST, FINAL_RDS_HOST, 'FINAL_IMPORT_HOST_REQUIRED');
  for (const slot of ['A', 'B']) {
    assert.match(env[`TRACEPOINT_FINAL_CAPTURE_${slot}_VERSION_ID`] ?? '', VERSION, `FINAL_IMPORT_${slot}_VERSION_REQUIRED`);
    assert.match(env[`TRACEPOINT_FINAL_CAPTURE_${slot}_BYTE_SHA256`] ?? '', SHA256, `FINAL_IMPORT_${slot}_HASH_REQUIRED`);
  }
  const rawSecret = env.TARGET_DATABASE_SECRET_JSON;
  assert.ok(rawSecret, 'FINAL_IMPORT_TARGET_SECRET_REQUIRED');
  const secret = JSON.parse(rawSecret);
  assert.ok(SECRET_HOSTS.has(secret.host), 'FINAL_IMPORT_SECRET_HOST_UNAPPROVED');
  assert.equal(secret.dbname, 'tracepoint', 'FINAL_IMPORT_SECRET_DATABASE_MISMATCH');
  assert.equal(Number(secret.port), 5432, 'FINAL_IMPORT_SECRET_PORT_MISMATCH');
  assert.ok(typeof secret.username === 'string' && secret.username.length > 0, 'FINAL_IMPORT_SECRET_USER_MISSING');
  assert.ok(typeof secret.password === 'string' && secret.password.length > 0, 'FINAL_IMPORT_SECRET_PASSWORD_MISSING');
  return { secret, slots: Object.fromEntries(['A', 'B'].map(slot => [slot, {
    bucket: ARTIFACT_BUCKET,
    key: `migration/source/${APPROVED_RUN_IDS[slot]}/final-canonical.json`,
    versionId: env[`TRACEPOINT_FINAL_CAPTURE_${slot}_VERSION_ID`],
    byteSha256: env[`TRACEPOINT_FINAL_CAPTURE_${slot}_BYTE_SHA256`],
  }])) };
}

export async function loadPinnedCapture(s3, spec) {
  const response = await s3.send(new GetObjectCommand({ Bucket: spec.bucket, Key: spec.key,
    VersionId: spec.versionId, ExpectedBucketOwner: ACCOUNT, ChecksumMode: 'ENABLED' }));
  assert.equal(response.VersionId, spec.versionId, 'FINAL_IMPORT_S3_VERSION_CHANGED');
  assert.equal(response.ServerSideEncryption, 'aws:kms', 'FINAL_IMPORT_ARTIFACT_ENCRYPTION_MISMATCH');
  assert.equal(response.SSEKMSKeyId, ARTIFACT_KMS_KEY_ARN, 'FINAL_IMPORT_ARTIFACT_KMS_MISMATCH');
  return { ...spec, bytes: new Uint8Array(await response.Body.transformToByteArray()) };
}

export async function runFinalImport(env = process.env, services = {}) {
  const { secret, slots } = validateFinalImportEnvironment(env);
  // Prevent accidental propagation into child processes or diagnostics.
  delete env.TARGET_DATABASE_SECRET_JSON;
  const s3 = services.s3 ?? new S3Client({ region: REGION, maxAttempts: 2 });
  const rds = services.rds ?? new RDSClient({ region: REGION, maxAttempts: 2 });
  let client;
  try {
    const [first, second, rdsResponse] = await Promise.all([
      loadPinnedCapture(s3, slots.A), loadPinnedCapture(s3, slots.B),
      rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: FINAL_RDS_INSTANCE })),
    ]);
    const target = rdsResponse.DBInstances?.[0];
    assert.ok(target, 'FINAL_IMPORT_TARGET_NOT_FOUND');
    assert.equal(target.DBInstanceArn, `arn:aws:rds:${REGION}:${ACCOUNT}:db:${FINAL_RDS_INSTANCE}`,
      'FINAL_IMPORT_TARGET_ACCOUNT_MISMATCH');
    assert.equal(target.DbiResourceId, FINAL_RDS_RESOURCE_ID, 'FINAL_IMPORT_TARGET_RESOURCE_DRIFT');
    assert.equal(target.Engine, 'postgres', 'FINAL_IMPORT_TARGET_ENGINE_MISMATCH');
    assert.equal(target.EngineVersion, '17.9', 'FINAL_IMPORT_TARGET_VERSION_MISMATCH');
    assert.equal(target.PubliclyAccessible, false, 'FINAL_IMPORT_TARGET_PUBLIC');
    assert.equal(target.StorageEncrypted, true, 'FINAL_IMPORT_TARGET_UNENCRYPTED');
    assert.equal(target.DeletionProtection, true, 'FINAL_IMPORT_TARGET_DELETION_UNPROTECTED');
    const ca = await readFile(env.TRACEPOINT_RDS_CA_PATH ?? '/app/rds-ca.pem', 'utf8');
    assert.match(ca, /BEGIN CERTIFICATE/, 'FINAL_IMPORT_RDS_CA_MISSING');
    client = services.client ?? new pg.Client({ host: FINAL_RDS_HOST, port: 5432, database: 'tracepoint',
      user: secret.username, password: secret.password,
      ssl: { ca, rejectUnauthorized: true, servername: FINAL_RDS_HOST },
      connectionTimeoutMillis: 15_000, statement_timeout: 60_000,
      application_name: 'tracepoint-final-capture-b-atomic-import' });
    await client.connect();
    const result = await runProductionFinalAtomicImport({ first, second, target, client,
      ...finalImportOperations() });
    return { ...result, tlsRequired: true, sourceReadOnly: true, objectCopyIncluded: false };
  } finally {
    await client?.end().catch(() => undefined);
    if (!services.s3) s3.destroy();
    if (!services.rds) rds.destroy();
  }
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await runFinalImport())); }
  catch (error) {
    const code = /^[A-Z][A-Z0-9_:]*$/.test(String(error?.message)) ? error.message : 'FINAL_IMPORT_FAILED';
    console.error(JSON.stringify({ status: 'BLOCKED', code }));
    process.exitCode = 1;
  }
}

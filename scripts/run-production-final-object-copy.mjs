#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { canonical } from './supabase-rest-ledger-core.mjs';
import { OBJECT_REFERENCE_COLUMNS, quote, reconcileObjectReferences } from './supabase-rest-import-core.mjs';
import { projectOmittedAgencyPatches, verifyOmittedAgencyPatches } from './production-final-patch-omission.mjs';
import { APPROVED_RUN_IDS, ARTIFACT_BUCKET, ARTIFACT_KMS_KEY_ARN,
  SOURCE_PROJECT_REF } from './source-production-final-capture-core.mjs';
import { parseAndVerifyArtifact } from './source-frozen-capture-parity-core.mjs';
import { FINAL_RDS_HOST, FINAL_RDS_INSTANCE, FINAL_RDS_RESOURCE_ID,
  planProductionFinalImport } from './production-final-import-core.mjs';
import { loadPinnedCapture } from './run-production-final-atomic-import.mjs';
import { validateFinalObjectArchive } from './production-final-object-archive-core.mjs';
import { copyProductionFinalObjects } from './production-final-object-copy-core.mjs';

const ACCOUNT = '193644343389';
const VERSION = /^[A-Za-z0-9._-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function validateFinalObjectCopyEnvironment(env) {
  assert.equal(env.TRACEPOINT_FINAL_OBJECT_COPY_EXECUTE, 'capture-b-objects-to-final-s3-v1',
    'FINAL_OBJECT_COPY_GUARD_REQUIRED');
  assert.equal(env.TRACEPOINT_EXPECTED_AWS_ACCOUNT, ACCOUNT, 'FINAL_OBJECT_ACCOUNT_REQUIRED');
  assert.equal(env.TRACEPOINT_TARGET_RESOURCE_ID, FINAL_RDS_RESOURCE_ID, 'FINAL_OBJECT_RDS_RESOURCE_REQUIRED');
  assert.equal(env.TARGET_PGHOST, FINAL_RDS_HOST, 'FINAL_OBJECT_RDS_HOST_REQUIRED');
  for (const slot of ['A', 'B']) {
    assert.match(env[`TRACEPOINT_FINAL_CAPTURE_${slot}_VERSION_ID`] ?? '', VERSION, `FINAL_OBJECT_${slot}_VERSION_REQUIRED`);
    assert.match(env[`TRACEPOINT_FINAL_CAPTURE_${slot}_BYTE_SHA256`] ?? '', SHA256, `FINAL_OBJECT_${slot}_HASH_REQUIRED`);
  }
  assert.match(env.TRACEPOINT_FINAL_OBJECT_ARCHIVE_B_VERSION_ID ?? '', VERSION,
    'FINAL_OBJECT_ARCHIVE_VERSION_REQUIRED');
  assert.match(env.TRACEPOINT_FINAL_OBJECT_ARCHIVE_B_BYTE_SHA256 ?? '', SHA256,
    'FINAL_OBJECT_ARCHIVE_HASH_REQUIRED');
  const secret = JSON.parse(env.TARGET_DATABASE_SECRET_JSON ?? 'null');
  assert.ok(new Set([FINAL_RDS_HOST,
    'tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com']).has(secret?.host),
  'FINAL_OBJECT_SECRET_HOST_UNAPPROVED');
  assert.equal(secret?.dbname, 'tracepoint', 'FINAL_OBJECT_DATABASE_REQUIRED');
  assert.equal(Number(secret?.port), 5432, 'FINAL_OBJECT_DATABASE_PORT_REQUIRED');
  assert.ok(typeof secret?.username === 'string' && typeof secret?.password === 'string',
    'FINAL_OBJECT_DATABASE_CREDENTIAL_REQUIRED');
  return { secret, captures: Object.fromEntries(['A', 'B'].map(slot => [slot, {
    bucket: ARTIFACT_BUCKET, key: `migration/source/${APPROVED_RUN_IDS[slot]}/final-canonical.json`,
    versionId: env[`TRACEPOINT_FINAL_CAPTURE_${slot}_VERSION_ID`],
    byteSha256: env[`TRACEPOINT_FINAL_CAPTURE_${slot}_BYTE_SHA256`],
  }])), archive: { key: `migration/source/${APPROVED_RUN_IDS.B}/object-archive.json`,
    versionId: env.TRACEPOINT_FINAL_OBJECT_ARCHIVE_B_VERSION_ID,
    byteSha256: env.TRACEPOINT_FINAL_OBJECT_ARCHIVE_B_BYTE_SHA256 } };
}

async function archiveSidecar(s3, spec) {
  const response = await s3.send(new GetObjectCommand({ Bucket: ARTIFACT_BUCKET, Key: spec.key,
    VersionId: spec.versionId, ExpectedBucketOwner: ACCOUNT, ChecksumMode: 'ENABLED' }));
  assert.equal(response.VersionId, spec.versionId, 'FINAL_OBJECT_ARCHIVE_VERSION_CHANGED');
  assert.equal(response.ServerSideEncryption, 'aws:kms', 'FINAL_OBJECT_ARCHIVE_UNENCRYPTED');
  assert.equal(response.SSEKMSKeyId, ARTIFACT_KMS_KEY_ARN, 'FINAL_OBJECT_ARCHIVE_KMS_MISMATCH');
  const bytes = await response.Body.transformToByteArray();
  assert.equal(createHash('sha256').update(bytes).digest('hex'), spec.byteSha256,
    'FINAL_OBJECT_ARCHIVE_BYTE_HASH_MISMATCH');
  const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  assert.equal(canonical(value), Buffer.from(bytes).toString('utf8'), 'FINAL_OBJECT_ARCHIVE_NOT_CANONICAL');
  return value;
}

export async function verifyFinalObjectReferences(client, artifact, manifest) {
  const patch = await verifyOmittedAgencyPatches(client, artifact, SOURCE_PROJECT_REF);
  assert.deepEqual(manifest.map(object => object.destinationKey).sort(),
    patch.inScopeManifest.map(object => object.destinationKey).sort(),
    'FINAL_OBJECT_IN_SCOPE_MANIFEST_MISMATCH');
  const summaries = [];
  for (const { relation, column } of OBJECT_REFERENCE_COLUMNS) {
    if (relation === 'departments' && column === 'patch_url') continue;
    const sourceRows = artifact.rows[relation];
    const targetRows = (await client.query(`select to_jsonb(t) as row from public.${quote(relation)} t order by t.id`))
      .rows.map(item => item.row);
    const result = reconcileObjectReferences(sourceRows, targetRows, column, manifest);
    assert.equal(result.sourceOnlyRows, 0, `FINAL_OBJECT_REFERENCE_SOURCE_ONLY:${relation}`);
    assert.equal(result.targetOnlyRows, 0, `FINAL_OBJECT_REFERENCE_TARGET_ONLY:${relation}`);
    assert.equal(result.missingCopiedObjects, 0, `FINAL_OBJECT_REFERENCE_MISSING:${relation}`);
    assert.equal(result.invalidReferences, 0, `FINAL_OBJECT_REFERENCE_INVALID:${relation}`);
    assert.equal(result.externalReferences, 0, `FINAL_OBJECT_REFERENCE_EXTERNAL:${relation}`);
    assert.equal(result.sourceHostedTargetLinks, 0, `FINAL_OBJECT_REFERENCE_STALE_SOURCE:${relation}`);
    assert.equal(result.targetNonNull, result.sourceNonNull,
      `FINAL_OBJECT_REFERENCE_COUNT_MISMATCH:${relation}`);
    if (relation !== 'departments') assert.equal(result.sourceTargetValueMismatches, 0,
      `FINAL_OBJECT_REFERENCE_VALUE_MISMATCH:${relation}`);
    summaries.push({ relation, column, references: result.copiedReferences,
      deliveryLinks: result.targetDeliveryLinks });
  }
  return summaries;
}

export async function runFinalObjectCopy(env = process.env, services = {}) {
  const { secret, captures, archive } = validateFinalObjectCopyEnvironment(env);
  delete env.TARGET_DATABASE_SECRET_JSON;
  const s3 = services.s3 ?? new S3Client({ region: 'us-east-1', maxAttempts: 2 });
  const rds = services.rds ?? new RDSClient({ region: 'us-east-1', maxAttempts: 2 });
  let client;
  try {
    const [first, second, sidecar, rdsResponse] = await Promise.all([
      loadPinnedCapture(s3, captures.A), loadPinnedCapture(s3, captures.B),
      archiveSidecar(s3, archive),
      rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: FINAL_RDS_INSTANCE })),
    ]);
    const target = rdsResponse.DBInstances?.[0];
    planProductionFinalImport({ first, second, target });
    assert.equal(target?.DBInstanceArn,
      `arn:aws:rds:us-east-1:${ACCOUNT}:db:${FINAL_RDS_INSTANCE}`, 'FINAL_OBJECT_RDS_ACCOUNT_MISMATCH');
    const artifact = parseAndVerifyArtifact(second.bytes, second.byteSha256, SOURCE_PROJECT_REF);
    const patch = projectOmittedAgencyPatches(artifact, SOURCE_PROJECT_REF);
    const manifest = validateFinalObjectArchive(sidecar, artifact,
      patch.omitted.map(item => item.destinationKey));
    assert.equal(manifest.length, patch.inScopeManifest.length,
      'FINAL_OBJECT_IN_SCOPE_COUNT_MISMATCH');
    const ca = await readFile(env.TRACEPOINT_RDS_CA_PATH ?? '/app/rds-ca.pem', 'utf8');
    client = services.client ?? new pg.Client({ host: FINAL_RDS_HOST, port: 5432,
      database: 'tracepoint', user: secret.username, password: secret.password,
      ssl: { ca, rejectUnauthorized: true, servername: FINAL_RDS_HOST },
      connectionTimeoutMillis: 15_000, statement_timeout: 60_000,
      application_name: 'tracepoint-final-object-reference-reconciliation' });
    await client.connect();
    await client.query('begin transaction read only');
    const db = (await client.query('select current_database() as name, inet_server_port()::int as port')).rows[0];
    assert.equal(db.name, 'tracepoint', 'FINAL_OBJECT_RDS_DATABASE_MISMATCH');
    assert.equal(db.port, 5432, 'FINAL_OBJECT_RDS_PORT_MISMATCH');
    assert.equal((await client.query('select ssl from pg_stat_ssl where pid=pg_backend_pid()')).rows[0]?.ssl,
      true, 'FINAL_OBJECT_RDS_TLS_REQUIRED');
    const references = await verifyFinalObjectReferences(client, artifact, manifest);
    await client.query('commit');
    const copied = await copyProductionFinalObjects(s3, manifest,
      patch.omitted.map(item => item.destinationKey));
    await client.query('begin transaction read only');
    const afterReferences = await verifyFinalObjectReferences(client, artifact, manifest);
    assert.deepEqual(afterReferences, references, 'FINAL_OBJECT_REFERENCES_CHANGED_DURING_COPY');
    await client.query('commit');
    return { status: 'FINAL_OBJECT_COPY_RECONCILED',
      targetResourceId: FINAL_RDS_RESOURCE_ID, objectCount: copied.copiedOrVerified,
      bytes: copied.bytes, missing: copied.missing, extra: copied.extra,
      explicitlyOmittedAgencyPatches: patch.omitted.length,
      excludedExistingObjects: copied.excludedExisting,
      referenceSummaries: references, sourceReadOnly: true };
  } catch (error) {
    await client?.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client?.end().catch(() => undefined);
    if (!services.s3) s3.destroy();
    if (!services.rds) rds.destroy();
  }
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await runFinalObjectCopy())); }
  catch (error) {
    const code = /^[A-Z][A-Z0-9_:]*$/.test(String(error?.message)) ? error.message : 'FINAL_OBJECT_COPY_FAILED';
    console.error(JSON.stringify({ status: 'BLOCKED', code }));
    process.exitCode = 1;
  }
}

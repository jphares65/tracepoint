import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { validateIdentityBatchCompletion, validateIdentityBatchManifest } from './cognito-identity-batch-core.mjs';

const run = promisify(execFile);
const runId = process.env.TRACEPOINT_IDENTITY_MIGRATION_RUN_ID ?? '';
const commit = process.env.TRACEPOINT_SOURCE_COMMIT ?? '';
const mode = process.env.TRACEPOINT_IDENTITY_MIGRATION_MODE ?? '';
const bucket = process.env.TRACEPOINT_MIGRATION_ARTIFACT_BUCKET ?? '';
const prefix = `migration/identity/${runId}`;
assert.match(runId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.match(commit, /^[0-9a-f]{40}$/);
assert.ok(['prepare', 'execute'].includes(mode));
assert.equal(process.env.TRACEPOINT_IDENTITY_MANIFEST_KEY, `${prefix}/manifest.json`);
if (mode === 'execute') {
  assert.equal(process.env.TRACEPOINT_IDENTITY_CHECKPOINT_KEY, `${prefix}/checkpoint.json`);
  assert.equal(process.env.TRACEPOINT_IDENTITY_EVIDENCE_KEY, `${prefix}/evidence.json`);
}
assert.match(bucket, /^tracepoint-(staging|production)-private-[0-9]{12}$/);
const artifactKeyArn = process.env.TRACEPOINT_MIGRATION_ARTIFACT_KMS_KEY_ARN ?? '';
assert.equal(artifactKeyArn, `arn:aws:kms:us-east-1:${process.env.TRACEPOINT_AWS_ACCOUNT_ID}:key/${artifactKeyArn.split('/').at(-1)}`);
const metadataOrigin = process.env.ECS_CONTAINER_METADATA_URI_V4;
assert.match(metadataOrigin ?? '', /^http:\/\/169\.254\.170\.2\/v4\/[A-Za-z0-9_-]+$/);
const metadata = await fetch(`${metadataOrigin}/task`, { redirect: 'error', signal: AbortSignal.timeout(5000) }).then(async response => {
  assert.equal(response.status, 200); return response.json() as Promise<{ TaskARN?: string; Family?: string }>;
});
assert.match(metadata.TaskARN ?? '', new RegExp(`^arn:aws:ecs:us-east-1:${process.env.TRACEPOINT_AWS_ACCOUNT_ID}:task/`));
assert.equal(metadata.Family, `tracepoint-${process.env.CONFIGURATION_ENVIRONMENT}-identity-${mode}-${runId}`);

const s3 = new S3Client({ region: 'us-east-1', maxAttempts: 1 });
async function download(key: string, required: boolean) {
  try {
    const value = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await value.Body?.transformToByteArray();
    assert.ok(bytes && bytes.byteLength > 0 && bytes.byteLength <= 10 * 1024 * 1024);
    return Buffer.from(bytes);
  } catch (error) {
    if (!required && typeof error === 'object' && error && '$metadata' in error && (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw new Error('Identity migration artifact could not be read.');
  }
}

const directory = await mkdtemp(path.join(tmpdir(), 'tracepoint-identity-migration-'));
try {
  const manifestPath = path.join(directory, 'manifest.json');
  const checkpointPath = path.join(directory, 'checkpoint.json');
  const encryption = { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: artifactKeyArn };
  if (mode === 'prepare') {
    const prepareArguments = ['--conditions=react-server', '--import', 'tsx', 'scripts/prepare-cognito-identity-batch.mts', '--prepare', '--output', manifestPath, '--actor-user-id', process.env.TRACEPOINT_IDENTITY_ACTOR_USER_ID!, '--department-id', process.env.TRACEPOINT_IDENTITY_DEPARTMENT_ID!, '--authorization-reference', process.env.TRACEPOINT_IDENTITY_AUTHORIZATION_REFERENCE!];
    if (process.env.TRACEPOINT_IDENTITY_AFTER_USER_ID) prepareArguments.push('--after-user-id', process.env.TRACEPOINT_IDENTITY_AFTER_USER_ID);
    const result = await run(process.execPath, prepareArguments, { env: process.env, timeout: 5 * 60_000, maxBuffer: 1024 * 1024 });
    const manifestBytes = await readFile(manifestPath);
    const parsed = JSON.parse(manifestBytes.toString('utf8'));
    const manifest = parsed.kind === 'identity-batch-complete' ? validateIdentityBatchCompletion(parsed) : validateIdentityBatchManifest(parsed);
    assert.equal(manifest.expectedAccount, process.env.TRACEPOINT_AWS_ACCOUNT_ID);
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: process.env.TRACEPOINT_IDENTITY_MANIFEST_KEY, Body: manifestBytes, ContentType: 'application/json', ...encryption }));
    console.log(JSON.stringify({ status: parsed.kind === 'identity-batch-complete' ? 'COMPLETE' : 'PREPARED', runId, commit, manifestSha256: manifest.contentSha256, users: 'users' in manifest ? manifest.users.length : 0, expiresAt: manifest.expiresAt, emailAddressesPrinted: false, writesToCognito: false, emailsSent: false }));
    assert.ok(result.stdout.includes(manifest.contentSha256));
  } else {
    const manifestBytes = await download(process.env.TRACEPOINT_IDENTITY_MANIFEST_KEY!, true);
    const manifest = validateIdentityBatchManifest(JSON.parse(manifestBytes!.toString('utf8')));
    assert.equal(manifest.expectedAccount, process.env.TRACEPOINT_AWS_ACCOUNT_ID);
    assert.equal(manifest.contentSha256, process.env.TRACEPOINT_IDENTITY_MANIFEST_SHA256);
    assert.equal(process.env.TRACEPOINT_IDENTITY_MIGRATION_AUTHORIZATION, `${manifest.authorizationReference}:${manifest.contentSha256}`);
    await writeFile(manifestPath, manifestBytes!, { flag: 'wx', mode: 0o600 });
    const checkpoint = await download(process.env.TRACEPOINT_IDENTITY_CHECKPOINT_KEY!, false);
    if (checkpoint) await writeFile(checkpointPath, checkpoint, { flag: 'wx', mode: 0o600 });
    const result = await run(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'scripts/migrate-cognito-identities.mts', '--manifest', manifestPath, '--checkpoint', checkpointPath, '--execute', '--acknowledge-cognito-writes', '--acknowledge-email-send'], { env: process.env, timeout: 60 * 60_000, maxBuffer: 1024 * 1024 });
    const evidence = JSON.parse(result.stdout.trim());
    assert.equal(evidence.manifestSha256, manifest.contentSha256);
    assert.match(evidence.reconciliationSha256 ?? '', /^[0-9a-f]{64}$/);
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: process.env.TRACEPOINT_IDENTITY_CHECKPOINT_KEY, Body: await readFile(checkpointPath), ContentType: 'application/json', ...encryption }));
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: process.env.TRACEPOINT_IDENTITY_EVIDENCE_KEY, Body: `${JSON.stringify(evidence)}\n`, ContentType: 'application/json', ...encryption }));
    console.log(JSON.stringify({ status: 'PASSED', runId, commit, manifestSha256: evidence.manifestSha256, reconciliationSha256: evidence.reconciliationSha256, users: evidence.total, emailAddressesPrinted: false }));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'FAILED', runId, errorName: error instanceof Error ? error.name : 'Error' }));
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}

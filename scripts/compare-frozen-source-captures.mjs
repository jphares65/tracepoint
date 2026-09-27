// Run only in the AWS-local capture environment. No source rows or object keys are logged.
import assert from 'node:assert/strict';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { compareFrozenCaptures, parseAndVerifyArtifact } from './source-frozen-capture-parity-core.mjs';

const bucket = 'tracepoint-production-private-193644343389';
const account = '193644343389';
const projectPrefixes = Object.freeze({
  reukdouvpshshvqnzsgw: 'migration/source-rehearsal/',
  izlkwggluhlhzlumtzes: 'migration/source/',
});

function argumentsFrom(argv) {
  const allowed = new Set(['--project', '--first-key', '--first-version', '--first-sha256',
    '--second-key', '--second-version', '--second-sha256', '--minimum-quiet-seconds']);
  assert.equal(argv.length % 2, 0, 'ARGUMENT_PAIR_REQUIRED');
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    assert.ok(allowed.has(argv[index]) && !values.has(argv[index]), 'UNEXPECTED_ARGUMENT');
    values.set(argv[index], argv[index + 1]);
  }
  const project = values.get('--project');
  const prefix = projectPrefixes[project];
  assert.ok(prefix, 'UNAPPROVED_SOURCE_PROJECT');
  const capture = label => {
    const key = values.get(`--${label}-key`);
    const versionId = values.get(`--${label}-version`);
    const byteSha256 = values.get(`--${label}-sha256`);
    assert.ok(key?.startsWith(prefix) && key.endsWith('/final-canonical.json'), 'UNAPPROVED_ARTIFACT_KEY');
    assert.match(key.slice(prefix.length), /^[0-9a-f-]{36}\/final-canonical\.json$/i, 'INVALID_CAPTURE_RUN_KEY');
    assert.ok(versionId && /^[A-Za-z0-9._-]+$/.test(versionId), 'ARTIFACT_VERSION_REQUIRED');
    assert.match(byteSha256 ?? '', /^[0-9a-f]{64}$/, 'ARTIFACT_HASH_REQUIRED');
    return { key, versionId, byteSha256 };
  };
  const first = capture('first');
  const second = capture('second');
  assert.notEqual(first.key, second.key, 'CAPTURE_KEYS_NOT_DISTINCT');
  if (project === 'izlkwggluhlhzlumtzes') {
    assert.equal(first.key, 'migration/source/1d761bd7-04dd-43f3-b77a-2c41130e18c2/final-canonical.json',
      'PRODUCTION_CAPTURE_A_KEY_MISMATCH');
    assert.equal(second.key, 'migration/source/c7448ea9-4645-4e99-b988-3a05de12ac70/final-canonical.json',
      'PRODUCTION_CAPTURE_B_KEY_MISMATCH');
  }
  const minimumQuietSeconds = Number(values.get('--minimum-quiet-seconds') ?? '60');
  assert.ok(Number.isSafeInteger(minimumQuietSeconds) && minimumQuietSeconds >= 60 && minimumQuietSeconds <= 3600,
    'INVALID_QUIET_WINDOW');
  return { project, first, second, minimumQuietMs: minimumQuietSeconds * 1000 };
}

async function readPinned(s3, spec, project) {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: spec.key,
    VersionId: spec.versionId, ExpectedBucketOwner: account }));
  assert.equal(result.VersionId, spec.versionId, 'ARTIFACT_VERSION_MISMATCH');
  return parseAndVerifyArtifact(await result.Body.transformToByteArray(), spec.byteSha256, project);
}

async function main() {
  const { project, first, second, minimumQuietMs } = argumentsFrom(process.argv.slice(2));
  const s3 = new S3Client({ region: 'us-east-1', maxAttempts: 1 });
  try {
    const earlier = await readPinned(s3, first, project);
    const later = await readPinned(s3, second, project);
    const result = compareFrozenCaptures(earlier, later, project, minimumQuietMs);
    assert.equal(result.status, 'FROZEN_SOURCE_QUIESCENT', 'AUTHORITATIVE_DELTA_DETECTED');
    console.log(JSON.stringify({ ...result, firstKey: first.key, firstVersionId: first.versionId,
      firstByteSha256: first.byteSha256, secondKey: second.key, secondVersionId: second.versionId,
      secondByteSha256: second.byteSha256,
      selectedFinalArtifact: project === 'izlkwggluhlhzlumtzes' ? second : null,
      rowPayloadsLogged: false }));
  } finally {
    s3.destroy();
  }
}

main().catch(error => {
  const code = /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'FROZEN_CAPTURE_COMPARISON_FAILED';
  console.error(JSON.stringify({ status: 'FAILED', code }));
  process.exitCode = 1;
});

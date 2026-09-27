#!/usr/bin/env node
// Read-only preparation of exact CloudFormation stages for the SES feedback worker.
// This script never creates a change set or updates a live AWS resource.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ACCOUNT = '193644343389';
const REGION = 'us-east-1';
const STACK = 'tracepoint-production-full-aws-ses-feedback-worker';
const WORKER = 'tracepoint-production-full-aws-ses--Worker11F36D0F-jKRMunYkq4Md';
const OLD_SECRET = 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/database/runtime-K4C4HY';
const FINAL_SECRET = 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/final/database-runtime-20260926-yg23sb';
const FINAL_DB = 'tracepoint-production-final-cutover-20260926';
const FINAL_HOST = 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const FINAL_RESOURCE_ID = 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE';
const BUCKET = 'cdk-hnb659fds-assets-193644343389-us-east-1';
const OLD_KEY = '0171243c1c2eeecf4a286774523c9cbe017b4cca30dd689612d9200f9a6cf66b.zip';
const OLD_VERSION = 'oySUk5G55PmFyhSlBCkouMG2Q7YX_iNy';
const KEY = '976f390e806fd918a4ffde7d635417076250ff87af737ef0d522a3e5dabf05a8.zip';
const VERSION = 'fr.zqjy0vM3.bEtxKOmGMBw1dgpLwe1w';
const NEW_CODE_SHA256 = 'EcwBLsLTL73JRC0i7CCyhx5VkS90qplYrt+571qiu+k=';
const OLD_CODE_SHA256 = '1BFMH2HTsUxClWIPZ5ZjBb1ehZeY0yLdK+U7jv4zC2w=';
const IDS = Object.freeze({
  worker: 'Worker11F36D0F',
  policy: 'WorkerRoleDefaultPolicy1750E153',
  mapping: 'WorkerSqsEventSourcetracepointproductionfullawssesFeedbackQueueAAC93C1D77138938',
});

function aws(...args) {
  const result = spawnSync('aws', [...args, '--profile', 'tracepoint-production', '--region', REGION, '--output', 'json'], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`AWS read failed (${args[0]} ${args[1]}): ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}
function clone(value) { return structuredClone(value); }
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function assertExactResourceDiff(baseline, changed, expectedIds) {
  const actual = Object.keys(baseline.Resources).filter(id => JSON.stringify(baseline.Resources[id]) !== JSON.stringify(changed.Resources[id]));
  assert.deepEqual(actual.sort(), [...expectedIds].sort());
  assert.deepEqual(Object.keys(changed.Resources).sort(), Object.keys(baseline.Resources).sort());
  assert.deepEqual(changed.Outputs, baseline.Outputs);
}

export function buildStages(original) {
  const baseline = clone(original);
  assert.equal(baseline.Resources[IDS.worker].Type, 'AWS::Lambda::Function');
  assert.equal(baseline.Resources[IDS.policy].Type, 'AWS::IAM::Policy');
  assert.equal(baseline.Resources[IDS.mapping].Type, 'AWS::Lambda::EventSourceMapping');
  const worker = baseline.Resources[IDS.worker].Properties;
  const statements = baseline.Resources[IDS.policy].Properties.PolicyDocument.Statement;
  const secretStatement = statements.filter(s => s.Action?.includes?.('secretsmanager:GetSecretValue'));
  assert.equal(secretStatement.length, 1);
  assert.deepEqual(secretStatement[0].Action, ['secretsmanager:DescribeSecret', 'secretsmanager:GetSecretValue']);
  assert.deepEqual(secretStatement[0].Resource, worker.Environment.Variables.TRACEPOINT_DATABASE_SECRET_ARN);
  assert.equal(worker.Code.S3Bucket, BUCKET);
  assert.equal(worker.Code.S3Key, OLD_KEY);
  assert.equal(worker.Handler, 'index.handler');
  assert.equal(worker.Runtime, 'nodejs24.x');
  assert.equal(worker.Environment.Variables.TRACEPOINT_FEEDBACK_DATABASE_AUTHORITY, undefined);
  assert.equal(baseline.Resources[IDS.mapping].Properties.Enabled, undefined);

  const oldPaused = clone(baseline);
  oldPaused.Resources[IDS.mapping].Properties.Enabled = false;
  assertExactResourceDiff(baseline, oldPaused, [IDS.mapping]);

  const finalPaused = clone(oldPaused);
  finalPaused.Resources[IDS.worker].Properties.Code = { S3Bucket: BUCKET, S3Key: KEY, S3ObjectVersion: VERSION };
  finalPaused.Resources[IDS.worker].Properties.Environment.Variables.TRACEPOINT_DATABASE_SECRET_ARN = FINAL_SECRET;
  finalPaused.Resources[IDS.worker].Properties.Environment.Variables.TRACEPOINT_FEEDBACK_DATABASE_AUTHORITY = 'final';
  finalPaused.Resources[IDS.policy].Properties.PolicyDocument.Statement
    .find(s => s.Action?.includes?.('secretsmanager:GetSecretValue')).Resource = FINAL_SECRET;
  assertExactResourceDiff(oldPaused, finalPaused, [IDS.worker, IDS.policy]);

  const finalActive = clone(finalPaused);
  finalActive.Resources[IDS.mapping].Properties.Enabled = true;
  assertExactResourceDiff(finalPaused, finalActive, [IDS.mapping]);

  const oldPinnedPaused = clone(oldPaused);
  oldPinnedPaused.Resources[IDS.worker].Properties.Code = { S3Bucket: BUCKET, S3Key: OLD_KEY, S3ObjectVersion: OLD_VERSION };
  assertExactResourceDiff(finalPaused, oldPinnedPaused, [IDS.worker, IDS.policy]);

  const oldActive = clone(oldPinnedPaused);
  oldActive.Resources[IDS.mapping].Properties.Enabled = true;
  assertExactResourceDiff(oldPinnedPaused, oldActive, [IDS.mapping]);
  assert.deepEqual(oldActive.Resources[IDS.worker].Properties.Environment, baseline.Resources[IDS.worker].Properties.Environment);
  assert.deepEqual(oldActive.Resources[IDS.policy], baseline.Resources[IDS.policy]);
  return { oldPaused, finalPaused, finalActive, oldPinnedPaused, oldActive };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const caller = aws('sts', 'get-caller-identity');
  assert.equal(caller.Account, ACCOUNT);
  const stack = aws('cloudformation', 'describe-stacks', '--stack-name', STACK).Stacks[0];
  assert.ok(['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus));
  const response = aws('cloudformation', 'get-template', '--stack-name', STACK, '--template-stage', 'Original');
  const original = typeof response.TemplateBody === 'string' ? JSON.parse(response.TemplateBody) : response.TemplateBody;
  const deployed = aws('lambda', 'get-function-configuration', '--function-name', WORKER);
  assert.equal(deployed.CodeSha256, OLD_CODE_SHA256);
  assert.equal(deployed.Environment.Variables.TRACEPOINT_DATABASE_SECRET_ARN, OLD_SECRET);
  assert.equal(deployed.Environment.Variables.TRACEPOINT_FEEDBACK_DATABASE_AUTHORITY, undefined);
  assert.equal(deployed.LastUpdateStatus, 'Successful');
  const object = aws('s3api', 'head-object', '--bucket', BUCKET, '--key', KEY, '--version-id', VERSION, '--checksum-mode', 'ENABLED');
  assert.equal(object.VersionId, VERSION);
  assert.equal(object.ChecksumSHA256, NEW_CODE_SHA256);
  const oldObject = aws('s3api', 'head-object', '--bucket', BUCKET, '--key', OLD_KEY, '--version-id', OLD_VERSION);
  assert.equal(oldObject.VersionId, OLD_VERSION);
  // The old CDK asset has no S3 checksum. Hash its exact versioned code bytes,
  // never customer data, to prove the reverse package matches deployed Lambda.
  const temporaryCode = resolve(tmpdir(), `tracepoint-old-worker-${process.pid}.zip`);
  try {
    const result = spawnSync('aws', ['s3api', 'get-object', '--bucket', BUCKET, '--key', OLD_KEY,
      '--version-id', OLD_VERSION, temporaryCode, '--profile', 'tracepoint-production', '--region', REGION,
      '--output', 'json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (result.status !== 0) throw new Error(`Old worker code attestation failed: ${result.stderr.trim()}`);
    assert.equal(createHash('sha256').update(readFileSync(temporaryCode)).digest('base64'), OLD_CODE_SHA256);
  } finally { rmSync(temporaryCode, { force: true }); }
  const finalDb = aws('rds', 'describe-db-instances', '--db-instance-identifier', FINAL_DB).DBInstances[0];
  assert.equal(finalDb.DbiResourceId, FINAL_RESOURCE_ID);
  assert.equal(finalDb.Endpoint.Address, FINAL_HOST);
  const finalSecret = aws('secretsmanager', 'describe-secret', '--secret-id', FINAL_SECRET);
  assert.equal(finalSecret.ARN, FINAL_SECRET);
  assert.equal(finalSecret.DeletedDate, undefined);
  const oldSecret = aws('secretsmanager', 'describe-secret', '--secret-id', OLD_SECRET);
  assert.equal(oldSecret.ARN, OLD_SECRET);
  assert.equal(oldSecret.KmsKeyId, finalSecret.KmsKeyId);
  const stages = buildStages(original);
  const out = resolve('infra/changesets/production-ses-worker-20260926');
  mkdirSync(out, { recursive: true });
  const manifest = { account: ACCOUNT, region: REGION, stack: STACK, worker: WORKER,
    originalTemplateSha256: digest(original), oldCodeSha256: OLD_CODE_SHA256,
    oldCodeBucket: BUCKET, oldCodeKey: OLD_KEY, oldCodeVersion: OLD_VERSION,
    finalCodeSha256: NEW_CODE_SHA256, finalCodeBucket: BUCKET,
    finalCodeKey: KEY, finalCodeVersion: VERSION, oldSecret: OLD_SECRET,
    finalSecret: FINAL_SECRET, finalDb: FINAL_DB, finalDbResourceId: FINAL_RESOURCE_ID,
    stages: {}, order: ['oldPaused', 'finalPaused', 'finalActive'],
    rollbackOrder: ['finalPaused', 'oldPinnedPaused', 'oldActive'],
    note: 'Review and execute only during an approved cutover window; generated with read-only AWS calls.' };
  for (const [stage, template] of Object.entries(stages)) {
    const file = `${stage}.json`;
    writeFileSync(resolve(out, file), `${JSON.stringify(template, null, 2)}\n`);
    manifest.stages[stage] = { file, sha256: digest(template) };
  }
  writeFileSync(resolve(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ output: out, manifest, liveWorkerUnchanged: true }, null, 2));
}

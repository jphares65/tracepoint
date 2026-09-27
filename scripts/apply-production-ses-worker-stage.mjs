#!/usr/bin/env node
// CUTOVER WINDOW ONLY. Applies one pre-reviewed worker stage with drift guards.
// Never run this during pre-cutover preparation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve('infra/changesets/production-ses-worker-20260926');
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
const stage = process.argv[process.argv.indexOf('--stage') + 1];
const maintenanceId = process.argv[process.argv.indexOf('--maintenance-window-id') + 1];
assert.ok(manifest.stages[stage], 'Choose one manifest stage with --stage.');
assert.ok(maintenanceId && !maintenanceId.startsWith('--'), 'A recorded maintenance-window ID is required.');
assert.equal(process.env.TRACEPOINT_CUTOVER_WINDOW_APPROVED, 'YES', 'Cutover-window approval flag is required.');

function aws(...args) {
  const result = spawnSync('aws', [...args, '--profile', 'tracepoint-production', '--region', manifest.region, '--output', 'json'], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`AWS ${args[0]} ${args[1]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
}
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function readCurrent() {
  const response = aws('cloudformation', 'get-template', '--stack-name', manifest.stack, '--template-stage', 'Original');
  return typeof response.TemplateBody === 'string' ? JSON.parse(response.TemplateBody) : response.TemplateBody;
}
const expectedPrevious = {
  oldPaused: [manifest.originalTemplateSha256],
  finalPaused: [manifest.stages.oldPaused.sha256, manifest.stages.finalActive.sha256],
  finalActive: [manifest.stages.finalPaused.sha256],
  oldPinnedPaused: [manifest.stages.finalPaused.sha256],
  oldActive: [manifest.stages.oldPinnedPaused.sha256],
};
const expectedChanged = {
  oldPaused: ['WorkerSqsEventSourcetracepointproductionfullawssesFeedbackQueueAAC93C1D77138938'],
  finalPaused: undefined, // forward = worker+policy; reverse = mapping only
  finalActive: ['WorkerSqsEventSourcetracepointproductionfullawssesFeedbackQueueAAC93C1D77138938'],
  oldPinnedPaused: ['Worker11F36D0F', 'WorkerRoleDefaultPolicy1750E153'],
  oldActive: ['WorkerSqsEventSourcetracepointproductionfullawssesFeedbackQueueAAC93C1D77138938'],
};

assert.equal(aws('sts', 'get-caller-identity').Account, manifest.account);
for (const [key, version] of [[manifest.oldCodeKey, manifest.oldCodeVersion],
  [manifest.finalCodeKey, manifest.finalCodeVersion]]) {
  const object = aws('s3api', 'head-object', '--bucket', manifest.oldCodeBucket,
    '--key', key, '--version-id', version);
  assert.equal(object.VersionId, version);
}
const stack = aws('cloudformation', 'describe-stacks', '--stack-name', manifest.stack).Stacks[0];
assert.ok(['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus));
const before = hash(readCurrent());
assert.ok(expectedPrevious[stage].includes(before), `Worker stack drift: ${stage} cannot follow current template ${before}.`);
const file = resolve(directory, manifest.stages[stage].file);
const intended = JSON.parse(readFileSync(file, 'utf8'));
assert.equal(hash(intended), manifest.stages[stage].sha256);
const name = `tracepoint-worker-${stage.toLowerCase()}-${Date.now()}`;
const created = aws('cloudformation', 'create-change-set', '--stack-name', manifest.stack,
  '--change-set-name', name, '--change-set-type', 'UPDATE', '--template-body', `file://${file}`,
  '--capabilities', 'CAPABILITY_NAMED_IAM');
const changeSet = created.Id;
try {
  const waiter = spawnSync('aws', ['cloudformation', 'wait', 'change-set-create-complete', '--change-set-name', changeSet,
    '--profile', 'tracepoint-production', '--region', manifest.region], { encoding: 'utf8' });
  if (waiter.status !== 0) throw new Error(`Change set did not validate: ${waiter.stderr.trim()}`);
  const plan = aws('cloudformation', 'describe-change-set', '--change-set-name', changeSet);
  assert.equal(plan.Status, 'CREATE_COMPLETE');
  const changed = plan.Changes.map(item => {
    const resource = item.ResourceChange;
    assert.equal(resource.Action, 'Modify');
    assert.equal(resource.Replacement, 'False');
    return resource.LogicalResourceId;
  }).sort();
  const expected = stage === 'finalPaused' && before === manifest.stages.finalActive.sha256
    ? ['WorkerSqsEventSourcetracepointproductionfullawssesFeedbackQueueAAC93C1D77138938']
    : expectedChanged[stage] ?? ['Worker11F36D0F', 'WorkerRoleDefaultPolicy1750E153'];
  assert.deepEqual(changed, expected.sort());
  const events = aws('cloudformation', 'describe-events', '--change-set-name', changeSet);
  assert.equal((events.OperationEvents ?? []).filter(item => item.EventType === 'VALIDATION_ERROR').length, 0);
  console.log(JSON.stringify({ maintenanceId, stage, changeSet, changed, replacements: 0,
    note: 'Validated; executing only this approved stage.' }));
  aws('cloudformation', 'execute-change-set', '--change-set-name', changeSet);
  const update = spawnSync('aws', ['cloudformation', 'wait', 'stack-update-complete', '--stack-name', manifest.stack,
    '--profile', 'tracepoint-production', '--region', manifest.region], { encoding: 'utf8' });
  if (update.status !== 0) throw new Error(`Stack update requires incident review: ${update.stderr.trim()}`);
  assert.equal(hash(readCurrent()), manifest.stages[stage].sha256);
  const worker = aws('lambda', 'get-function-configuration', '--function-name', manifest.worker);
  assert.equal(worker.LastUpdateStatus, 'Successful');
  assert.equal(worker.CodeSha256, stage.startsWith('final') ? manifest.finalCodeSha256 : manifest.oldCodeSha256);
  assert.equal(worker.Environment.Variables.TRACEPOINT_DATABASE_SECRET_ARN,
    stage.startsWith('final') ? manifest.finalSecret : manifest.oldSecret);
  assert.equal(worker.Environment.Variables.TRACEPOINT_FEEDBACK_DATABASE_AUTHORITY,
    stage.startsWith('final') ? 'final' : undefined);
  console.log(JSON.stringify({ maintenanceId, stage, workerCodeSha256: worker.CodeSha256,
    stackStatus: 'UPDATE_COMPLETE', note: 'Check event-source State and queue/DB correlation before the next stage.' }));
} catch (error) {
  // Never auto-delete or auto-rollback after an execution may have begun.
  throw error;
}

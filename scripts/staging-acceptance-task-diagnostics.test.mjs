import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureFixtureTaskFailure } from './staging-acceptance-task-diagnostics.mjs';

test('captures the sanitized database verification error emitted by the fixture task', () => {
  const result = captureFixtureTaskFailure('acceptance-fixture-verify', 'remove-staging-fixture-objects', {
    status: 1,
    stderr: `${JSON.stringify({ stagingAcceptanceFixture: 'failed', stage: 'ownership.attest_storage_object', operation: 'ownership.attest_storage_object', sqlstate: '42703', table: 'audit_events', column: 'storage_path', message: 'column "storage_path" does not exist', databaseUrl: 'postgres://secret', password: 'do-not-copy' })}\nPowerShell invocation failed`,
  });
  assert.deepEqual(result, {
    action: 'acceptance-fixture-verify', stage: 'remove-staging-fixture-objects', classification: 'FIXTURE_DATABASE_FAILED',
    processStatus: 1,
    diagnostic: { sqlstate: '42703', operation: 'ownership.attest_storage_object', table: 'audit_events', column: 'storage_path', message: 'column "storage_path" does not exist' },
  });
  assert.doesNotMatch(JSON.stringify(result), /postgres|secret|password|do-not-copy/i);
});

test('classifies ECS image-pull failures and retains only safe stop metadata', () => {
  const result = captureFixtureTaskFailure('acceptance-fixture-verify', 'remove-staging-fixture-objects', {
    status: 1,
    stderr: 'Migration task failed (stop code TaskFailedToStart; stopped reason CannotPullContainerError: failed resolving private registry; exit code not reported).',
  });
  assert.deepEqual(result, {
    action: 'acceptance-fixture-verify', stage: 'remove-staging-fixture-objects', classification: 'ECS_IMAGE_PULL_FAILED',
    processStatus: 1, taskStopCode: 'TaskFailedToStart',
  });
});

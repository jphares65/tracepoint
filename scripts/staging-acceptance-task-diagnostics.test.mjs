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

test('preserves sanitized diagnostic JSON read from the failed fixture task CloudWatch stream', () => {
  const diagnostic = {
    stagingAcceptanceFixture: 'failed', stage: 'cleanup', operation: 'ownership.attest_storage_object',
    sqlstate: '42703', table: 'audit_events', column: 'storage_path', position: 17,
    message: 'column "storage_path" does not exist for officer@example.invalid',
    detail: 'record id 12345678-1234-1234-1234-123456789012', hint: 'check schema', executionContext: 'fixture.verify',
    connectionString: 'postgres://user:password@host/private',
  };
  const result = captureFixtureTaskFailure('acceptance-fixture-verify', 'remove-staging-fixture-objects', {
    status: 1,
    stdout: `${JSON.stringify(diagnostic)}\nMigration task failed (stop code EssentialContainerExited; exit code 1).`,
  });
  assert.equal(result.classification, 'FIXTURE_DATABASE_FAILED');
  assert.deepEqual(result.diagnostic, {
    fixtureStage: 'cleanup', sqlstate: '42703', operation: 'ownership.attest_storage_object',
    table: 'audit_events', column: 'storage_path', position: 17,
    message: 'column "storage_path" does not exist for [redacted-email]',
    detail: 'record id [redacted-id]', hint: 'check schema', executionContext: 'fixture.verify',
  });
  assert.doesNotMatch(JSON.stringify(result), /postgres|password|officer@example|12345678/i);
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

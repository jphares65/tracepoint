import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { retryTransientAws } from './run-staging-cognito-acceptance.mjs';
import { fixtureTaskFailureLine } from './staging-acceptance-fixture-storage.mjs';

// Run 4c66f928 (2026-10-23): the verify task blocked the runner for minutes, Windows aborted the idle pooled S3
// connection, and the delete on it failed with ECONNABORTED, which the AWS SDK does not retry. Cleanup stopped twice,
// leaving the run's object and database fixture in place. Storage calls now go through the runner's retry, and a
// fixture task's failure line is printed instead of discarded.

const noDelay = () => 0;
const failing = (code, times, value = 'ok') => {
  let calls = 0;
  const operation = async () => { calls += 1; if (calls <= times) throw Object.assign(new Error(code), { code }); return value; };
  return { operation, calls: () => calls };
};

test('a connection aborted once is retried on a fresh attempt', async () => {
  const send = failing('ECONNABORTED', 1);
  assert.equal(await retryTransientAws(send.operation, noDelay), 'ok');
  assert.equal(send.calls(), 2);
});

test('transient failures are retried at most three times in all; other errors are not retried', async () => {
  const persistent = failing('ECONNABORTED', 5);
  await assert.rejects(retryTransientAws(persistent.operation, noDelay), { code: 'ECONNABORTED' });
  assert.equal(persistent.calls(), 3);
  const denied = failing('AccessDenied', 1);
  await assert.rejects(retryTransientAws(denied.operation, noDelay), { code: 'AccessDenied' });
  assert.equal(denied.calls(), 1);
});

test('every storage call in cleanup is retried, and the objects are listed again after the verify task', async () => {
  const source = await readFile(new URL('./run-staging-cognito-acceptance.mjs', import.meta.url), 'utf8');
  const listing = source.slice(source.indexOf('async function listFixtureStorage('), source.indexOf('// Deletes only the objects'));
  const cleanup = source.slice(source.indexOf('async function cleanupStorage('), source.indexOf('async function deleteCognitoUsers('));
  for (const body of [listing, cleanup]) {
    assert.ok((body.match(/s3\.send\(/g) ?? []).length > 0);
    assert.equal((body.match(/s3\.send\(/g) ?? []).length, (body.match(/retryTransientAws\(\(\) => s3\.send\(/g) ?? []).length);
  }
  const verify = cleanup.indexOf("runFixtureTask('acceptance-fixture-verify'");
  const replan = cleanup.indexOf('planFixtureStorageDeletion(', verify);
  const remove = cleanup.indexOf('new DeleteObjectCommand(');
  assert.ok(verify > 0 && replan > verify && remove > replan, 'the deletion set is planned from a listing taken after verify');
});

test('a fixture task failure reports its own failure line, sanitized', () => {
  const output = [
    'Verified account 559054714699, role TracePointMigrationStaging, region us-east-1.',
    'Migration task failed (stop code TaskFailedToStart; stopped reason CannotPullContainerError: pull image manifest has been retried 1 time(s): 559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging@sha256:626b44c9c2ca4c9df37f5bb0e3da0ab2b5a3b6fd84c2b77e0dc2a5e4b1a2c3d4: not found; container reason ; exit code ).',
    'At C:\\scripts\\apply-app-migrations.ps1:444 char:7',
    '+ CategoryInfo          : OperationStopped: (Migration task failed ...) [], RuntimeException',
  ].join('\r\n');
  const line = fixtureTaskFailureLine(output);
  assert.match(line, /^Migration task failed \(stop code TaskFailedToStart; stopped reason CannotPullContainerError/);
  assert.match(line, /sha256:626b44c9c2ca/);
  assert.equal(fixtureTaskFailureLine('Fixture failed for acceptance-x-officer@example.invalid with token eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop'), 'Fixture failed for [redacted-email] with token [redacted-token]');
  assert.equal(fixtureTaskFailureLine("Acceptance fixture manifest failed with value 'secret-ish'"), 'Acceptance fixture manifest failed with value [redacted]');
  assert.equal(fixtureTaskFailureLine('all good\nAWS-native migration task succeeded'), null);
  assert.equal(fixtureTaskFailureLine(undefined), null);
});

test('the runner prints the fixture task failure line and nothing else from its output', async () => {
  const source = await readFile(new URL('./run-staging-cognito-acceptance.mjs', import.meta.url), 'utf8');
  const task = source.slice(source.indexOf('function runFixtureTask('), source.indexOf('async function listFixtureStorage('));
  assert.match(task, /fixtureTaskFailureLine\(/);
  assert.doesNotMatch(task, /console\.(?:log|error)\([^)]*result\.(?:stdout|stderr)\s*\)/);
});

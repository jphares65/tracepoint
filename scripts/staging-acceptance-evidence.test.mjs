import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { acceptanceReportDirectory, createAcceptanceReport, sanitizeAcceptanceCheck, sanitizeFixtureTaskFailure, writeAcceptanceReport } from './staging-acceptance-evidence.mjs';

const fixtureRun = 'd92f7280-536f-4cea-99e4-1c8e08fac4da';
const sourceCommit = '7eb69c7f19ef95ac4cb04adcb180b2c5e24b4c20';
const appImageDigest = `sha256:${'a'.repeat(64)}`;

test('acceptance evidence keeps only sanitized check fields and precise safe diagnostics', () => {
  const result = sanitizeAcceptanceCheck({
    name: 'Agency B cannot write Agency A records', status: 'fail', role: 'officer', phase: 'agency-b-cross-tenant-isolation',
    evidence: { expected: { responseStatus: 403 }, actual: { responseStatus: 201, agencyMatches: false }, email: 'private@example.invalid' },
    diagnostics: { callbackStatus: 303, hostClass: 'application', password: 'never-copy', totpSecret: 'never-copy' },
    password: 'never-copy', token: 'never-copy',
  });
  assert.deepEqual(result, {
    name: 'Agency B cannot write Agency A records', status: 'fail', role: 'officer', phase: 'agency-b-cross-tenant-isolation',
    evidence: { expected: { responseStatus: 403 }, actual: { responseStatus: 201, agencyMatches: false } },
    diagnostics: { callbackStatus: 303, hostClass: 'application' },
  });
  assert.doesNotMatch(JSON.stringify(result), /private@example|never-copy|password|totpSecret/i);
});

test('acceptance report pins source and deployed target and omits credentials', () => {
  const report = createAcceptanceReport({
    fixtureRun, sourceCommit, taskRevision: '193', appImageDigest, startedAt: '2026-10-23T12:00:00.000Z',
    status: 'fail', stage: 'authenticated-pkce-mfa-acceptance', cleanup: 'pass', failureCode: 'ASSERTION_FAILED',
    checks: [{ name: 'Audit event appears in tenant feed', status: 'fail', evidence: { expected: { event: 'department_patch_upload' }, actual: { matchingEvents: 0 } }, password: 'never-copy' }],
    passwords: ['never-copy'], mfaSecret: 'never-copy',
  });
  assert.equal(report.environment, 'staging');
  assert.equal(report.sourceCommit, sourceCommit);
  assert.deepEqual(report.target, { taskRevision: '193', appImageDigest });
  assert.equal(report.checks[0].evidence.actual.matchingEvents, 0);
  assert.equal(report.failureCode, 'ASSERTION_FAILED');
  assert.doesNotMatch(JSON.stringify(report), /never-copy|password|mfaSecret/i);
});

test('fixture task failure evidence retains safe action and database diagnostics only', () => {
  const failure = sanitizeFixtureTaskFailure({
    action: 'acceptance-fixture-verify', stage: 'remove-staging-fixture-objects', classification: 'FIXTURE_DATABASE_FAILED',
    processStatus: 1, taskStopCode: 'EssentialContainerExited', containerExitCode: 1, retryAttempts: 3,
    diagnostic: {
      sqlstate: '42703', operation: 'ownership.attest_storage_object', table: 'audit_events', column: 'storage_path',
      message: 'column "storage_path" does not exist', detail: 'password=should-not-appear', schema: 'public',
    },
    stdout: 'password=should-not-appear', stderr: 'token=should-not-appear', mfaSecret: 'should-not-appear',
  });
  assert.deepEqual(failure, {
    action: 'acceptance-fixture-verify', stage: 'remove-staging-fixture-objects', classification: 'FIXTURE_DATABASE_FAILED',
    processStatus: 1, taskStopCode: 'EssentialContainerExited', containerExitCode: 1, retryAttempts: 3,
    diagnostic: { sqlstate: '42703', operation: 'ownership.attest_storage_object', table: 'audit_events', column: 'storage_path', message: 'column "storage_path" does not exist', schema: 'public' },
  });
  assert.doesNotMatch(JSON.stringify(failure), /should-not-appear|password|token|secret/i);
});

test('acceptance report durably preserves safe fixture task failure details', () => {
  const report = createAcceptanceReport({
    fixtureRun, sourceCommit, taskRevision: '194', appImageDigest, startedAt: '2026-10-23T12:00:00.000Z',
    status: 'fail', stage: 'remove-staging-fixture-objects', cleanup: 'fail',
    fixtureTaskFailures: [{ action: 'acceptance-fixture-verify', stage: 'remove-staging-fixture-objects', classification: 'ECS_IMAGE_PULL_FAILED', taskStopCode: 'TaskFailedToStart' }],
  });
  assert.deepEqual(report.fixtureTaskFailures, [{ action: 'acceptance-fixture-verify', stage: 'remove-staging-fixture-objects', classification: 'ECS_IMAGE_PULL_FAILED', taskStopCode: 'TaskFailedToStart' }]);
});

test('acceptance report writer stores the sanitized report durably as JSON', async () => {
  const report = createAcceptanceReport({
    fixtureRun, sourceCommit, taskRevision: '193', appImageDigest, startedAt: '2026-10-23T12:00:00.000Z',
    status: 'running', stage: 'authenticated-pkce-mfa-acceptance', cleanup: 'pending',
    checks: [{ name: 'Audit feed contains successful patch event', status: 'pass', evidence: { expected: { action: 'department_patch_upload', result: 'succeeded' }, actual: { successfulEvents: 1 } } }],
  });
  await writeAcceptanceReport(report);
  report.status = 'pass';
  report.stage = 'complete';
  report.cleanup = 'pass';
  const path = await writeAcceptanceReport(report);
  const recoveryPath = await writeAcceptanceReport({
    ...report, status: 'fail', stage: 'remove-staging-fixture-objects', cleanup: 'fail',
    fixtureTaskFailures: [{ action: 'acceptance-fixture-verify', stage: 'remove-staging-fixture-objects', classification: 'ECS_IMAGE_PULL_FAILED', taskStopCode: 'TaskFailedToStart' }],
  }, { suffix: 'recovery-20261023T163333Z-a1b2c3' });
  try {
    const stored = JSON.parse(await readFile(path, 'utf8'));
    const recovery = JSON.parse(await readFile(recoveryPath, 'utf8'));
    assert.equal(stored.fixtureRun, fixtureRun);
    assert.equal(stored.status, 'pass');
    assert.equal(stored.checks[0].evidence.actual.successfulEvents, 1);
    assert.doesNotMatch(JSON.stringify(stored), /password|secret|token|@example/i);
    assert.equal(recovery.status, 'fail');
    assert.equal(recovery.fixtureTaskFailures[0].classification, 'ECS_IMAGE_PULL_FAILED');
  } finally {
    await unlink(path);
    await unlink(recoveryPath);
  }
});

// Run 08243a2c: the report was written into docs/ before fixture create, and apply-app-migrations.ps1 refused the
// untracked file (Require-CleanCommit: git status --porcelain --untracked-files=all).
const checkout = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cleanCommitStatus = () => execFileSync('git', ['-C', checkout, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });

test('writing a run report leaves the checkout exactly as clean as before', async () => {
  const before = cleanCommitStatus();
  const report = createAcceptanceReport({ fixtureRun, sourceCommit, taskRevision: '194', appImageDigest, startedAt: '2026-10-24T01:18:10.953Z',
    status: 'running', stage: 'seed-staging-database-fixtures', cleanup: 'pending' });
  const written = await writeAcceptanceReport(report, { environment: {} });
  try {
    assert.equal(path.relative(checkout, written).startsWith('..'), true, written);
    assert.equal(path.dirname(written), path.join(tmpdir(), 'tracepoint-staging-acceptance-evidence'));
    assert.equal(cleanCommitStatus(), before);
  } finally {
    await unlink(written);
  }
});

test('the evidence directory is refused inside the checkout, relative, or reached through a link', async () => {
  const refused = { message: /outside the checkout|absolute path/ };
  for (const directory of [checkout, path.join(checkout, 'docs', 'staging-acceptance-evidence'), 'docs/staging-acceptance-evidence']) {
    await assert.rejects(acceptanceReportDirectory({ TRACEPOINT_ACCEPTANCE_EVIDENCE_DIR: directory }), refused, directory);
  }
  const outside = await mkdtemp(path.join(tmpdir(), 'tp-evidence-link-'));
  try {
    const linked = path.join(outside, 'into-checkout');
    await symlink(path.join(checkout, 'docs'), linked, 'junction');
    await assert.rejects(acceptanceReportDirectory({ TRACEPOINT_ACCEPTANCE_EVIDENCE_DIR: linked }), refused);
    assert.equal(await acceptanceReportDirectory({ TRACEPOINT_ACCEPTANCE_EVIDENCE_DIR: path.join(outside, 'reports') }), path.join(outside, 'reports'));
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

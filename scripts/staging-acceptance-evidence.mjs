import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const reportDirectory = path.join(repositoryRoot, 'docs', 'staging-acceptance-evidence');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = /^[0-9a-f]{40}$/i;
const digest = /^sha256:[0-9a-f]{64}$/i;
const roles = new Set(['officer', 'instructor', 'supervisor', 'administrator', 'unknown']);
const statuses = new Set(['running', 'pass', 'fail']);
const evidenceKeys = new Set(['expected', 'actual']);
const safeStrings = new Set([
  'department_patch_upload', 'succeeded', 'failed', 'application', 'cognito', 'other', 'unknown',
  'login', 'home', 'callback', '200-for-agency-B-or-401/403', 'report', 'equipment_asset',
  'damaged', 'out_of_service', 'active', 'not_found', 'permission_denied',
  // Sign-in callback outcomes (staging-cognito-login.mjs): landings, the application's fixed notices, OAuth error codes.
  'none', 'authorization_rejected', 'authorization_unavailable', 'session_expired', 'logout_unconfirmed',
  'access_denied', 'invalid_request', 'unauthorized_client', 'unsupported_response_type', 'invalid_scope', 'server_error', 'temporarily_unavailable',
]);
const diagnosticKeys = new Set([
  'step',
  'barcodeDetectorAvailable', 'imageCount', 'canvasCount', 'qrDecoded', 'totpPayloadFound',
  'manualSetupVisible', 'onCognitoHost', 'callbackReached', 'hostClass', 'pathClass',
  'mfaPromptVisible', 'otpInputVisible', 'passwordInputVisible', 'invalidCodeNotice',
  'expiredCodeNotice', 'retryNotice', 'genericRequestError', 'totpSubmissions', 'callbackStatus',
  'callbackLanding', 'loginNotice', 'providerError', 'callbackHadCode', 'callbackHadState', 'flowCookiePresent',
  'callbacksSeen', 'signInStarts', 'callbackSeconds',
]);
const fixtureTaskActions = new Set(['acceptance-fixture-create', 'acceptance-fixture-cleanup', 'acceptance-fixture-verify']);
const fixtureTaskClassifications = new Set([
  'POWERSHELL_START_FAILED', 'AWS_ACCESS_DENIED', 'ECS_IMAGE_PULL_FAILED', 'ECS_TASK_FAILED',
  'FIXTURE_DATABASE_FAILED', 'FIXTURE_TASK_FAILED', 'FIXTURE_TASK_TIMEOUT',
]);
const fixtureTaskStopCodes = new Set(['EssentialContainerExited', 'TaskFailedToStart', 'SpotInterruption', 'UserInitiated']);

function safePrimitive(value) {
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (typeof value === 'string' && safeStrings.has(value)) return value;
  return undefined;
}

function safeEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  for (const key of evidenceKeys) {
    const entry = value[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const sanitized = Object.fromEntries(Object.entries(entry).flatMap(([name, item]) => {
      const primitive = safePrimitive(item);
      return /^[a-z][a-zA-Z0-9]{0,48}$/.test(name) && primitive !== undefined ? [[name, primitive]] : [];
    }));
    if (Object.keys(sanitized).length) result[key] = sanitized;
  }
  return Object.keys(result).length ? result : undefined;
}

function safeTaskDiagnosticText(value) {
  if (typeof value !== 'string' || !value || /(?:password|secret|token|cookie|authorization|credential)/i.test(value)) return undefined;
  const safe = value.replace(/[\r\n\t]+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '[redacted-id]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{48,})\b/g, '[redacted-token]')
    .replace(/(?:https?:\/\/|[A-Za-z]:\\|\\\\)[^\s,;]*/gi, '[redacted-location]')
    .slice(0, 320);
  return safe || undefined;
}

/** Keeps the task's safe failure identity while excluding raw PowerShell/AWS output and credentials. */
export function sanitizeFixtureTaskFailure(failure) {
  if (!failure || typeof failure !== 'object' || !fixtureTaskActions.has(failure.action) ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(failure.stage ?? '') || !fixtureTaskClassifications.has(failure.classification)) {
    throw new Error('Fixture task failure evidence is invalid.');
  }
  const result = { action: failure.action, stage: failure.stage, classification: failure.classification };
  if (Number.isInteger(failure.processStatus) && failure.processStatus >= 0 && failure.processStatus <= 255) result.processStatus = failure.processStatus;
  if (typeof failure.processErrorCode === 'string' && /^(?:ENOENT|EACCES|EPERM|E2BIG|UNKNOWN)$/.test(failure.processErrorCode)) result.processErrorCode = failure.processErrorCode;
  if (fixtureTaskStopCodes.has(failure.taskStopCode)) result.taskStopCode = failure.taskStopCode;
  if (Number.isInteger(failure.containerExitCode) && failure.containerExitCode >= 0 && failure.containerExitCode <= 255) result.containerExitCode = failure.containerExitCode;
  if (Number.isInteger(failure.retryAttempts) && failure.retryAttempts >= 1 && failure.retryAttempts <= 5) result.retryAttempts = failure.retryAttempts;
  if (typeof failure.s3RetryFailureCode === 'string' && /^(?:ECONNABORTED|ECONNRESET|EPIPE|ETIMEDOUT|TimeoutError|AbortError|RequestTimeout|RequestTimeoutException|SlowDown|ServiceUnavailable|InternalError|HTTP_(?:500|502|503|504))$/.test(failure.s3RetryFailureCode)) {
    result.s3RetryFailureCode = failure.s3RetryFailureCode;
  }
  const diagnostic = failure.diagnostic;
  if (diagnostic && typeof diagnostic === 'object' && !Array.isArray(diagnostic)) {
    const safe = {};
    if (/^[0-9A-Z]{5}$/.test(diagnostic.sqlstate ?? '')) safe.sqlstate = diagnostic.sqlstate;
    if (/^[A-Z0-9_]{1,48}$/.test(diagnostic.failureCode ?? '')) safe.failureCode = diagnostic.failureCode;
    if (/^[a-z][a-z0-9-]{0,63}$/.test(diagnostic.stage ?? '')) safe.fixtureStage = diagnostic.stage;
    if (/^[a-z_][a-z0-9_.]{0,127}$/.test(diagnostic.operation ?? '')) safe.operation = diagnostic.operation;
    for (const key of ['schema', 'table', 'column', 'routine']) if (/^[a-z_][a-z0-9_]{0,62}$/.test(diagnostic[key] ?? '')) safe[key] = diagnostic[key];
    if (Number.isInteger(diagnostic.position) && diagnostic.position > 0) safe.position = diagnostic.position;
    for (const key of ['message', 'detail', 'hint', 'executionContext']) {
      const text = safeTaskDiagnosticText(diagnostic[key]);
      if (text) safe[key] = text;
    }
    if (Object.keys(safe).length) result.diagnostic = safe;
  }
  return result;
}

export function sanitizeAcceptanceCheck(check) {
  let name = typeof check?.name === 'string' ? check.name.trim().slice(0, 180) : '';
  name = name.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '[redacted-id]');
  if (/(?:password|secret|token|cookie|authorization)/i.test(name)) name = 'Acceptance check (redacted)';
  if (!name || !['pass', 'fail'].includes(check?.status)) throw new Error('Acceptance check evidence is invalid.');
  const result = { name, status: check.status };
  if (/^[A-Z0-9_]{1,48}$/.test(check.code ?? '')) result.code = check.code;
  if (roles.has(check.role)) result.role = check.role;
  if (/^[a-z][a-z0-9-]{0,63}$/.test(check.phase ?? '')) result.phase = check.phase;
  if (/^[A-Za-z]*Error$/.test(check.errorName ?? '')) result.errorName = check.errorName;
  const evidence = safeEvidence(check.evidence);
  if (evidence) result.evidence = evidence;
  if (check.diagnostics && typeof check.diagnostics === 'object') {
    const diagnostics = Object.fromEntries(Object.entries(check.diagnostics).filter(([key]) => diagnosticKeys.has(key))
      .flatMap(([key, value]) => {
        if (key === 'step' && typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value)) return [[key, value]];
        const primitive = safePrimitive(value);
        return primitive !== undefined ? [[key, primitive]] : [];
      }));
    if (Object.keys(diagnostics).length) result.diagnostics = diagnostics;
  }
  return result;
}

export function createAcceptanceReport({ fixtureRun, sourceCommit, taskRevision, appImageDigest, startedAt, checks = [], fixtureTaskFailures = [], stage = 'startup', status = 'running', cleanup = 'pending', failureCode }) {
  if (!uuid.test(String(fixtureRun)) || !sha.test(String(sourceCommit)) || !/^\d{1,6}$/.test(String(taskRevision)) || !digest.test(String(appImageDigest))) {
    throw new Error('Acceptance report identity is invalid.');
  }
  if (!statuses.has(status) || !['pending', 'pass', 'fail'].includes(cleanup)) throw new Error('Acceptance report status is invalid.');
  const report = {
    schemaVersion: 1,
    environment: 'staging',
    fixtureRun,
    sourceCommit,
    target: { taskRevision: String(taskRevision), appImageDigest },
    startedAt: new Date(startedAt).toISOString(),
    updatedAt: new Date().toISOString(),
    status,
    stage: /^[a-z][a-z0-9-]{0,63}$/.test(stage) ? stage : 'unknown',
    checks: checks.map(sanitizeAcceptanceCheck),
    fixtureTaskFailures: fixtureTaskFailures.map(sanitizeFixtureTaskFailure),
    cleanup,
  };
  if (status !== 'running') report.completedAt = report.updatedAt;
  if (/^[A-Z0-9_]{1,48}$/.test(failureCode ?? '')) report.failureCode = failureCode;
  return report;
}

/** Writes one run-specific JSON report atomically; the report includes only validated, sanitized fields. */
export async function writeAcceptanceReport(report, { suffix = '' } = {}) {
  if (suffix && !/^recovery-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}$/.test(suffix)) throw new Error('Acceptance report suffix is invalid.');
  const safe = createAcceptanceReport({
    fixtureRun: report?.fixtureRun,
    sourceCommit: report?.sourceCommit,
    taskRevision: report?.target?.taskRevision,
    appImageDigest: report?.target?.appImageDigest,
    startedAt: report?.startedAt,
    checks: report?.checks,
    fixtureTaskFailures: report?.fixtureTaskFailures,
    stage: report?.stage,
    status: report?.status,
    cleanup: report?.cleanup,
    failureCode: report?.failureCode,
  });
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, `${safe.fixtureRun}${suffix ? `.${suffix}` : ''}.json`);
  const tempPath = `${reportPath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(safe, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, reportPath);
  return reportPath;
}

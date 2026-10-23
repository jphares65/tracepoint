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
  'login', 'home', 'callback', '200-for-agency-B-or-401/403',
]);
const diagnosticKeys = new Set([
  'barcodeDetectorAvailable', 'imageCount', 'canvasCount', 'qrDecoded', 'totpPayloadFound',
  'manualSetupVisible', 'onCognitoHost', 'callbackReached', 'hostClass', 'pathClass',
  'mfaPromptVisible', 'otpInputVisible', 'passwordInputVisible', 'invalidCodeNotice',
  'expiredCodeNotice', 'retryNotice', 'genericRequestError', 'totpSubmissions', 'callbackStatus',
]);

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
        const primitive = safePrimitive(value);
        return primitive !== undefined ? [[key, primitive]] : [];
      }));
    if (Object.keys(diagnostics).length) result.diagnostics = diagnostics;
  }
  return result;
}

export function createAcceptanceReport({ fixtureRun, sourceCommit, taskRevision, appImageDigest, startedAt, checks = [], stage = 'startup', status = 'running', cleanup = 'pending', failureCode }) {
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
    cleanup,
  };
  if (status !== 'running') report.completedAt = report.updatedAt;
  if (/^[A-Z0-9_]{1,48}$/.test(failureCode ?? '')) report.failureCode = failureCode;
  return report;
}

/** Writes one run-specific JSON report atomically; the report includes only validated, sanitized fields. */
export async function writeAcceptanceReport(report) {
  const safe = createAcceptanceReport({
    fixtureRun: report?.fixtureRun,
    sourceCommit: report?.sourceCommit,
    taskRevision: report?.target?.taskRevision,
    appImageDigest: report?.target?.appImageDigest,
    startedAt: report?.startedAt,
    checks: report?.checks,
    stage: report?.stage,
    status: report?.status,
    cleanup: report?.cleanup,
    failureCode: report?.failureCode,
  });
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, `${safe.fixtureRun}.json`);
  const tempPath = `${reportPath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(safe, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, reportPath);
  return reportPath;
}

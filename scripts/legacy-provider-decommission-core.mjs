import { createHash } from 'node:crypto';

const SHA256 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const FORBIDDEN_ACCOUNTS = new Set(['111111111111', '265544358665', '559054714699']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const sha256 = value => createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && canonical(Object.keys(value).sort()) === canonical([...keys].sort());

export const DECOMMISSION_GATES = [
  'awsBackupsRestorable', 'databaseReconciled', 'dnsAndTrafficOffLegacyProviders',
  'identitySessionsAndRecoveryProven', 'legacyAuthEnrollmentClosed', 'legacyCredentialsAbsent',
  'legacyEndpointsAbsent', 'noUnresolvedMigrationDelta', 'retentionAndLegalApproved',
  'rollbackExportImmutable', 'sesFeedbackAndSuppressionProven', 'storageReconciled',
];

export function evaluateLegacyProviderDecommission(evidence, now = new Date()) {
  const failures = [];
  if (!exact(evidence, [
    'account', 'authorizationReference', 'databaseManifestSha256', 'environment', 'gates',
    'identityManifestSha256', 'observationWindow', 'rollbackExportSha256', 'runtimeImageDigest',
    'runtimeScanSha256', 'storageManifestSha256',
  ])) failures.push('Evidence fields do not match the reviewed schema');
  if (evidence?.environment !== 'production') failures.push('Only production legacy providers can be evaluated');
  if (!/^\d{12}$/.test(evidence?.account ?? '') || FORBIDDEN_ACCOUNTS.has(evidence?.account)) failures.push('A reviewed dedicated production account is required');
  if (!/^[A-Z0-9][A-Z0-9._:/-]{7,127}$/.test(evidence?.authorizationReference ?? '')) failures.push('A specific decommission authorization reference is required');
  if (!DIGEST.test(evidence?.runtimeImageDigest ?? '')) failures.push('An immutable AWS-native runtime image is required');
  for (const field of ['databaseManifestSha256', 'identityManifestSha256', 'rollbackExportSha256', 'runtimeScanSha256', 'storageManifestSha256']) {
    if (!SHA256.test(evidence?.[field] ?? '')) failures.push(`${field} must be a lowercase SHA-256`);
  }
  if (!exact(evidence?.gates, DECOMMISSION_GATES)) failures.push('Decommission gates do not match the reviewed schema');
  for (const gate of DECOMMISSION_GATES) if (evidence?.gates?.[gate] !== true) failures.push(`Unmet decommission gate: ${gate}`);

  const window = evidence?.observationWindow;
  if (!exact(window, ['endedAt', 'minimumHours', 'startedAt'])) failures.push('Observation window does not match the reviewed schema');
  const started = Date.parse(window?.startedAt ?? '');
  const ended = Date.parse(window?.endedAt ?? '');
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) failures.push('Observation timestamps are invalid');
  if (!Number.isInteger(window?.minimumHours) || window.minimumHours < 168) failures.push('At least 168 hours of AWS-native observation is required');
  if (Number.isFinite(started) && Number.isFinite(ended) && ended - started < (window?.minimumHours ?? Infinity) * 3_600_000) failures.push('Observation window is incomplete');
  if (Number.isFinite(ended) && ended > now.getTime()) failures.push('Observation window has not ended');

  return { eligible: failures.length === 0, failures: [...new Set(failures)] };
}

export function prepareLegacyProviderDecommission(evidence, now = new Date()) {
  const evaluation = evaluateLegacyProviderDecommission(evidence, now);
  if (!evaluation.eligible) throw new Error(evaluation.failures.join('; '));
  const plan = {
    format: 1,
    preparedAt: now.toISOString(),
    evidenceSha256: sha256(canonical(evidence)),
    executionAuthorized: false,
    destructiveExecutionEnabled: false,
    providers: [
      { name: 'Supabase', order: 1, actions: ['retain immutable rollback export', 'revoke runtime keys', 'disable Auth enrollment, Realtime, and Functions', 'hold database and storage read-only for the approved retention period', 'cancel and delete only under a later destructive authorization'] },
      { name: 'Vercel', order: 2, actions: ['confirm DNS and traffic remain on AWS', 'revoke deployment and runtime credentials', 'disable deployments', 'cancel and delete only under a later destructive authorization'] },
      { name: 'Brevo', order: 3, actions: ['confirm SES suppression and feedback parity', 'revoke API and SMTP credentials', 'disable sending', 'cancel and delete only under a later destructive authorization'] },
    ],
  };
  return { ...plan, contentSha256: sha256(canonical(plan)) };
}


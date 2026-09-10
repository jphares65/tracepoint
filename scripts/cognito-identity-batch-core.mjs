import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT = /^\d{12}$/;
const FORBIDDEN_ACCOUNTS = new Set(['111111111111', '265544358665']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const sha256 = value => createHash('sha256').update(value).digest('hex');

function fail(message) {
  throw new Error(message);
}

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || canonical(Object.keys(value).sort()) !== canonical([...keys].sort())) fail(`${label} fields are invalid`);
}

export function createIdentityBatchManifest(input, createdAt = new Date().toISOString()) {
  exact(input, ['actorUserId', 'authorizationReference', 'environment', 'expectedAccount', 'siteUrl', 'users'], 'Identity batch');
  if (!['staging', 'production'].includes(input.environment)) fail('Environment must be staging or production');
  if (!ACCOUNT.test(input.expectedAccount ?? '') || FORBIDDEN_ACCOUNTS.has(input.expectedAccount)) fail('Expected account is invalid');
  if (input.siteUrl !== (input.environment === 'production' ? 'https://tracepointhq.com' : 'https://staging.tracepointhq.com')) fail('Site URL does not match the migration environment');
  if (!UUID.test(input.actorUserId ?? '')) fail('Actor user ID is invalid');
  if (!/^[A-Z0-9][A-Z0-9._:/-]{7,127}$/.test(input.authorizationReference ?? '')) fail('A specific authorization reference is required');
  if (!Array.isArray(input.users) || input.users.length < 1 || input.users.length > 10_000) fail('Identity batch must contain 1 to 10,000 users');
  const itemHashes = new Set();
  const users = input.users.map(user => {
    exact(user, ['departmentId', 'targetUserId'], 'Identity item');
    if (!UUID.test(user.departmentId ?? '') || !UUID.test(user.targetUserId ?? '')) fail('Identity item UUID is invalid');
    const normalized = { departmentId: user.departmentId.toLowerCase(), targetUserId: user.targetUserId.toLowerCase() };
    const itemSha256 = sha256(canonical(normalized));
    if (itemHashes.has(itemSha256)) fail('Duplicate identity batch item');
    itemHashes.add(itemSha256);
    return { ...normalized, itemSha256 };
  });
  if (!Number.isFinite(Date.parse(createdAt))) fail('Manifest timestamp is invalid');
  const payload = { format: 1, createdAt, ...input, actorUserId: input.actorUserId.toLowerCase(), users };
  return { ...payload, contentSha256: sha256(canonical(payload)) };
}

export function validateIdentityBatchManifest(manifest) {
  exact(manifest, ['actorUserId', 'authorizationReference', 'contentSha256', 'createdAt', 'environment', 'expectedAccount', 'format', 'siteUrl', 'users'], 'Identity batch manifest');
  if (manifest.format !== 1) fail('Identity batch manifest format is unsupported');
  const input = {
    actorUserId: manifest.actorUserId,
    authorizationReference: manifest.authorizationReference,
    environment: manifest.environment,
    expectedAccount: manifest.expectedAccount,
    siteUrl: manifest.siteUrl,
    users: manifest.users.map(({ departmentId, targetUserId }) => ({ departmentId, targetUserId })),
  };
  const rebuilt = createIdentityBatchManifest(input, manifest.createdAt);
  if (canonical(rebuilt) !== canonical(manifest)) fail('Identity batch manifest integrity check failed');
  return manifest;
}

export function validateIdentityCheckpoint(checkpoint, manifest) {
  if (checkpoint === null || checkpoint === undefined) return new Set();
  exact(checkpoint, ['completedItemSha256', 'format', 'manifestSha256'], 'Identity checkpoint');
  if (checkpoint.format !== 1 || checkpoint.manifestSha256 !== manifest.contentSha256 || !Array.isArray(checkpoint.completedItemSha256)) fail('Identity checkpoint does not match the manifest');
  const allowed = new Set(manifest.users.map(user => user.itemSha256));
  const completed = new Set();
  for (const hash of checkpoint.completedItemSha256) {
    if (!allowed.has(hash) || completed.has(hash)) fail('Identity checkpoint item is invalid');
    completed.add(hash);
  }
  return completed;
}

export function identityCheckpoint(manifest, completed) {
  return { format: 1, manifestSha256: manifest.contentSha256, completedItemSha256: [...completed].sort() };
}


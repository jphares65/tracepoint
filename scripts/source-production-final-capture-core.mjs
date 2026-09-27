import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MIGRATION_RELATIONS, RELATION_ORDER_COLUMNS, canonical, sha256 } from './supabase-rest-ledger-core.mjs';

export const SOURCE_PROJECT_REF = 'izlkwggluhlhzlumtzes';
export const SOURCE_ORIGIN = `https://${SOURCE_PROJECT_REF}.supabase.co`;
export const SOURCE_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-supabase-rest-wvh4pi';
export const ARTIFACT_BUCKET = 'tracepoint-production-private-193644343389';
export const ARTIFACT_KMS_KEY_ARN = 'arn:aws:kms:us-east-1:193644343389:key/4dc71990-3cfa-49d7-88c6-383bc1067f55';
export const STORAGE_BUCKETS = Object.freeze(['department-assets', 'tracepoint-attachments']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const APPROVED_RUN_ID = '0762cf3d-5f8e-4e89-afa0-051a39e4dce7';

export function validateCaptureEnvironment(env) {
  assert.equal(env.TRACEPOINT_SOURCE_PRODUCTION_PROJECT_REF, SOURCE_PROJECT_REF, 'PRODUCTION_PROJECT_REF_REQUIRED');
  assert.equal(env.TRACEPOINT_EXPECTED_AWS_ACCOUNT, '193644343389', 'EXACT_AWS_ACCOUNT_REQUIRED');
  assert.equal(env.SOURCE_PRODUCTION_PROJECT_URL, SOURCE_ORIGIN, 'PRODUCTION_SOURCE_URL_REQUIRED');
  assert.match(env.TRACEPOINT_SOURCE_PRODUCTION_RUN_ID ?? '', UUID, 'RUN_UUID_REQUIRED');
  assert.equal(env.TRACEPOINT_SOURCE_PRODUCTION_RUN_ID, APPROVED_RUN_ID, 'EXACT_FINAL_CAPTURE_RUN_REQUIRED');
  assert.match(env.SOURCE_PRODUCTION_SERVICE_KEY ?? '', /^(sb_secret_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_.-]{40,})$/, 'PRODUCTION_SERVER_KEY_REQUIRED');
  return Object.freeze({ runId: env.TRACEPOINT_SOURCE_PRODUCTION_RUN_ID,
    key: `migration/source/${env.TRACEPOINT_SOURCE_PRODUCTION_RUN_ID}/final-canonical.json` });
}

export function sourceRequest(method, url) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, SOURCE_ORIGIN, 'PRODUCTION_SOURCE_ONLY');
  assert.equal(parsed.protocol, 'https:', 'HTTPS_REQUIRED');
  const relation = parsed.pathname.slice('/rest/v1/'.length);
  const readPath = (parsed.pathname.startsWith('/rest/v1/') && MIGRATION_RELATIONS.includes(relation))
    || parsed.pathname === '/auth/v1/admin/users'
    || STORAGE_BUCKETS.some(bucket => parsed.pathname.startsWith(`/storage/v1/object/authenticated/${bucket}/`));
  const postReadPath = parsed.pathname === '/rest/v1/rpc/tracepoint_source_production_fence_status'
    || STORAGE_BUCKETS.some(bucket => parsed.pathname === `/storage/v1/object/list/${bucket}`);
  assert.ok((method === 'GET' && readPath) || (method === 'POST' && postReadPath), 'CAPTURE_READ_PATH_ONLY');
  return parsed;
}

export function relationUrl(relation, offset, limit = 500) {
  assert.ok(MIGRATION_RELATIONS.includes(relation), 'UNAPPROVED_RELATION');
  assert.ok(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 1000, 'INVALID_PAGE');
  const order = RELATION_ORDER_COLUMNS[relation] ?? ['id'];
  assert.ok(order.every(column => /^[a-z][a-z0-9_]*$/.test(column)), 'INVALID_ORDER_CONTRACT');
  return `${SOURCE_ORIGIN}/rest/v1/${relation}?select=*&order=${order.map(column => `${column}.asc`).join(',')}&offset=${offset}&limit=${limit}`;
}

export function objectPath(bucket, key) {
  assert.ok(STORAGE_BUCKETS.includes(bucket), 'UNAPPROVED_BUCKET');
  assert.ok(typeof key === 'string' && key.length > 0 && key.length < 1024, 'INVALID_OBJECT_KEY');
  const parts = key.split('/');
  assert.ok(parts.every(part => part && part !== '.' && part !== '..'), 'UNSAFE_OBJECT_KEY');
  return `${SOURCE_ORIGIN}/storage/v1/object/authenticated/${bucket}/${parts.map(encodeURIComponent).join('/')}`;
}

export function classifyStorageEntry(prefix, entry) {
  assert.ok(entry && typeof entry.name === 'string' && entry.name.length > 0 && !entry.name.includes('/'), 'UNSAFE_STORAGE_ENTRY');
  const fullKey = `${prefix}${entry.name}`;
  assert.ok(fullKey.split('/').every(part => part && part !== '.' && part !== '..'), 'UNSAFE_STORAGE_PATH');
  return entry.id == null ? { kind: 'folder', prefix: `${fullKey}/` } : { kind: 'object', key: fullKey };
}

export function attestFrozen(value) {
  assert.equal(value?.frozen, true, 'PRODUCTION_FENCE_NOT_ACTIVE');
  assert.equal(value?.database, 'postgres', 'SOURCE_DATABASE_MISMATCH');
  assert.equal(Number(value?.relation_count), 122, 'SOURCE_RELATION_COUNT_DRIFT');
  assert.equal(Number(value?.trigger_count), 244, 'SOURCE_FENCE_TRIGGER_COUNT_DRIFT');
  assert.ok(Number.isFinite(Date.parse(value?.changed_at)), 'FENCE_TIMESTAMP_MISSING');
  return value.changed_at;
}

export function buildArtifact({ runId, capturedAtUtc, fenceChangedAt, rowsByRelation, identities, objects }) {
  assert.match(runId, UUID);
  assert.ok(Number.isFinite(Date.parse(capturedAtUtc)));
  assert.ok(Number.isFinite(Date.parse(fenceChangedAt)));
  assert.deepEqual([...rowsByRelation.keys()], [...MIGRATION_RELATIONS], 'COMPLETE_RELATION_SET_REQUIRED');
  assert.ok(Array.isArray(identities) && Array.isArray(objects));
  const tables = [...rowsByRelation].map(([name, rows]) => ({ name, rows: rows.length, canonicalDataSha256: sha256(rows) }));
  const memberships = rowsByRelation.get('department_memberships');
  const body = {
    format: 'tracepoint-immutable-source-artifact/v1', runId,
    authorizationReference: 'TP-PRODUCTION-FINAL-SOURCE-20260927', capturedAtUtc,
    source: { provider: 'supabase-rest-admin', projectRef: SOURCE_PROJECT_REF, projectUrl: SOURCE_ORIGIN,
      readOnlyMethods: ['GET', 'POST:fixed-read-only-rpc-and-storage-list'], fenceChangedAt,
      relationContract: [...MIGRATION_RELATIONS] },
    tables, totalRelationalRows: tables.reduce((sum, table) => sum + table.rows, 0),
    identities: { count: identities.length, canonicalDataSha256: sha256(identities), rows: identities },
    memberships: { count: memberships.length, canonicalDataSha256: sha256(memberships) },
    objects: { count: objects.length, totalBytes: objects.reduce((sum, item) => sum + item.bytes, 0),
      manifestSha256: sha256(objects), manifest: objects },
    rows: Object.fromEntries(rowsByRelation),
  };
  const masterSha256 = sha256(body);
  const payload = canonical({ ...body, masterSha256 });
  return { body, payload, masterSha256, byteSha256: createHash('sha256').update(payload).digest('hex') };
}

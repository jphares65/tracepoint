import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MIGRATION_RELATIONS, RELATION_ORDER_COLUMNS, canonical, sha256 } from './supabase-rest-ledger-core.mjs';

export const SOURCE_PROJECT_REF = 'reukdouvpshshvqnzsgw';
export const SOURCE_ORIGIN = `https://${SOURCE_PROJECT_REF}.supabase.co`;
export const ARTIFACT_BUCKET = 'tracepoint-production-private-193644343389';
export const ARTIFACT_KMS_KEY_ARN = 'arn:aws:kms:us-east-1:193644343389:key/4dc71990-3cfa-49d7-88c6-383bc1067f55';
export const STORAGE_BUCKETS = Object.freeze(['department-assets', 'tracepoint-attachments']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateCaptureEnvironment(env) {
  assert.equal(env.TRACEPOINT_SOURCE_REHEARSAL_PROJECT_REF, SOURCE_PROJECT_REF, 'Exact paid source-rehearsal project is required');
  assert.equal(env.TRACEPOINT_EXPECTED_AWS_ACCOUNT, '193644343389', 'Exact AWS account is required');
  assert.match(env.TRACEPOINT_SOURCE_REHEARSAL_RUN_ID ?? '', UUID, 'A UUID run ID is required');
  assert.match(env.SOURCE_REHEARSAL_SECRET_KEY ?? '', /^sb_secret_[A-Za-z0-9_-]{20,}$/, 'Paid-project server key is required');
  return Object.freeze({
    runId: env.TRACEPOINT_SOURCE_REHEARSAL_RUN_ID,
    key: `migration/source-rehearsal/${env.TRACEPOINT_SOURCE_REHEARSAL_RUN_ID}/final-canonical.json`,
  });
}

export function sourceRequest(method, url) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, SOURCE_ORIGIN, 'Only the paid source-rehearsal project is permitted');
  assert.equal(parsed.protocol, 'https:', 'Source access requires HTTPS');
  const readPath = parsed.pathname.startsWith('/rest/v1/') || parsed.pathname === '/auth/v1/admin/users' || parsed.pathname.startsWith('/storage/v1/object/');
  const postReadPath = parsed.pathname === '/rest/v1/rpc/tracepoint_source_rehearsal_fence_status' || STORAGE_BUCKETS.some(bucket => parsed.pathname === `/storage/v1/object/list/${bucket}`);
  assert.ok((method === 'GET' && readPath) || (method === 'POST' && postReadPath), 'Source capture is read-only and path-limited');
  return parsed;
}

export function relationUrl(relation, offset, limit = 500) {
  assert.ok(MIGRATION_RELATIONS.includes(relation), 'Unapproved relation');
  assert.ok(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 1000, 'Invalid page');
  const order = RELATION_ORDER_COLUMNS[relation] ?? ['id'];
  assert.ok(order.every(column => /^[a-z][a-z0-9_]*$/.test(column)), 'Invalid order contract');
  return `${SOURCE_ORIGIN}/rest/v1/${relation}?select=*&order=${order.map(column => `${column}.asc`).join(',')}&offset=${offset}&limit=${limit}`;
}

export function objectPath(bucket, key) {
  assert.ok(STORAGE_BUCKETS.includes(bucket), 'Unapproved source bucket');
  assert.ok(typeof key === 'string' && key.length > 0 && key.length < 1024, 'Invalid object key');
  const parts = key.split('/');
  assert.ok(parts.every(part => part && part !== '.' && part !== '..'), 'Unsafe object key');
  return `${SOURCE_ORIGIN}/storage/v1/object/${bucket}/${parts.map(encodeURIComponent).join('/')}`;
}

export function classifyStorageEntry(prefix, entry) {
  assert.ok(entry && typeof entry.name === 'string' && entry.name.length > 0 && !entry.name.includes('/'), 'Unsafe Storage listing entry');
  const fullKey = `${prefix}${entry.name}`;
  assert.ok(fullKey.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe Storage listing path');
  return entry.id == null ? { kind: 'folder', prefix: `${fullKey}/` } : { kind: 'object', key: fullKey };
}

export function attestFrozen(value) {
  assert.equal(value?.frozen, true, 'SOURCE_REHEARSAL_FENCE_NOT_ACTIVE');
  assert.equal(value?.database, 'postgres', 'Unexpected source database');
  assert.ok(Number.isFinite(Date.parse(value?.changed_at)), 'Fence activation time missing');
  return value.changed_at;
}

export function buildArtifact({ runId, capturedAtUtc, fenceChangedAt, rowsByRelation, identities, objects }) {
  assert.match(runId, UUID);
  assert.ok(Number.isFinite(Date.parse(capturedAtUtc)));
  assert.ok(Number.isFinite(Date.parse(fenceChangedAt)));
  assert.deepEqual([...rowsByRelation.keys()], [...MIGRATION_RELATIONS], 'Complete reviewed relation set required');
  assert.ok(Array.isArray(identities) && Array.isArray(objects));
  const tables = [...rowsByRelation].map(([name, rows]) => ({ name, rows: rows.length, canonicalDataSha256: sha256(rows) }));
  const memberships = rowsByRelation.get('department_memberships');
  const body = {
    format: 'tracepoint-immutable-source-artifact/v1', runId,
    authorizationReference: 'TP-SOURCE-REHEARSAL-20260925', capturedAtUtc,
    source: { provider: 'supabase-rest-admin', projectRef: SOURCE_PROJECT_REF, projectUrl: SOURCE_ORIGIN, readOnlyMethods: ['GET', 'POST:fixed-read-only-rpc-and-storage-list'], fenceChangedAt, relationContract: [...MIGRATION_RELATIONS] },
    tables, totalRelationalRows: tables.reduce((sum, table) => sum + table.rows, 0),
    identities: { count: identities.length, canonicalDataSha256: sha256(identities), rows: identities },
    memberships: { count: memberships.length, canonicalDataSha256: sha256(memberships) },
    objects: { count: objects.length, totalBytes: objects.reduce((sum, item) => sum + item.bytes, 0), manifestSha256: sha256(objects), manifest: objects },
    rows: Object.fromEntries(rowsByRelation),
  };
  const masterSha256 = sha256(body);
  const payload = canonical({ ...body, masterSha256 });
  return { body, payload, masterSha256, byteSha256: createHash('sha256').update(payload).digest('hex') };
}

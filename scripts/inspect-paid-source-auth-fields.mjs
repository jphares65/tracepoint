#!/usr/bin/env node
// Read-only synthetic Auth field inventory. Never emits values or credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const PROJECT = 'reukdouvpshshvqnzsgw';
const SECRET = 'tracepoint/production/migration/source-rehearsal-only-20260925';
function aws(args) {
  return execFileSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
    [...args, '--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'text'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }).trim();
}

try {
  assert.equal(aws(['sts', 'get-caller-identity', '--query', 'Account']), '193644343389');
  const key = aws(['secretsmanager', 'get-secret-value', '--secret-id', SECRET, '--query', 'SecretString']);
  assert.match(key, /^sb_secret_[A-Za-z0-9_-]{20,}$/);
  const response = await fetch(`https://${PROJECT}.supabase.co/auth/v1/admin/users?page=1&per_page=2`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(Array.isArray(payload.users) && payload.users.length > 0 && payload.users.length <= 2);
  const fieldNames = [...new Set(payload.users.flatMap(user => Object.keys(user)))].sort();
  const identityFieldNames = [...new Set(payload.users.flatMap(user =>
    (Array.isArray(user.identities) ? user.identities : []).flatMap(identity => Object.keys(identity))))].sort();
  console.log(JSON.stringify({ projectRef: PROJECT, userCountInspected: payload.users.length,
    fieldNames, identityFieldNames, recordValuesEmitted: false }));
} catch {
  console.error('PAID_AUTH_FIELD_INVENTORY_FAILED');
  process.exitCode = 2;
}

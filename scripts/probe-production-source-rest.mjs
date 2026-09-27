import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCE_ORIGIN, sourceRequest } from './source-production-final-capture-core.mjs';

// Safe local diagnostic: stdin receives only the exact AWS secret JSON through
// an in-memory shell pipe; no customer rows or key material are emitted.
const secret = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(secret.projectUrl, SOURCE_ORIGIN, 'PRODUCTION_REST_SECRET_PROJECT_MISMATCH');
assert.ok(typeof secret.serviceRoleKey === 'string' && secret.serviceRoleKey.length > 20,
  'PRODUCTION_REST_KEY_MISSING');
const url = `${SOURCE_ORIGIN}/rest/v1/feature_catalog?select=code&limit=0`;
sourceRequest('GET', url);
const response = await fetch(url, { headers: { apikey: secret.serviceRoleKey, Accept: 'application/json' },
  redirect: 'error', signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error(`PRODUCTION_REST_READ_PROBE_FAILED:${response.status}`);
const rows = await response.json();
assert.deepEqual(rows, [], 'ZERO_ROW_PROBE_RETURNED_DATA');
console.log(JSON.stringify({ status: 'PRODUCTION_REST_ZERO_ROW_READ_PASS', projectRef: 'izlkwggluhlhzlumtzes',
  httpStatus: response.status, customerRowsRead: 0, sourceMutation: false }));

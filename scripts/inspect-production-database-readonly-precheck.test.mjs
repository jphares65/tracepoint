import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const probe = readFileSync(new URL('./inspect-production-database-readonly-precheck.mjs', import.meta.url), 'utf8');
const report = readFileSync(new URL('../docs/source-fence-database-default-rehearsal-20260927.md', import.meta.url), 'utf8');

test('production precheck is pinned and uses only read-only catalog queries', () => {
  assert.match(probe, /izlkwggluhlhzlumtzes/);
  assert.match(probe, /BEGIN READ ONLY/);
  assert.match(probe, /rejectUnauthorized: true/);
  assert.match(probe, /databaseWideReadOnlySetting/);
  assert.match(probe, /PRODUCTION_DATABASE_ALREADY_DEFAULT_READ_ONLY/);
  assert.doesNotMatch(probe, /client\.query\(['"`]\s*(?:ALTER|UPDATE|DELETE|INSERT|SELECT pg_terminate_backend)/i);
});

test('rehearsal report records an explicit read-write override and reversal', () => {
  assert.match(report, /BEGIN READ WRITE/);
  assert.match(report, /"default": "on", "transaction": "off"/);
  assert.match(report, /RESET\s+default_transaction_read_only/);
  assert.match(report, /248 fence triggers/);
  assert.match(report, /SOURCE FENCE REPAIR BLOCKED/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../database/aws/023_audit_log_read_authorization.sql', import.meta.url), 'utf8');
const repairSql = readFileSync(new URL('../database/aws/032_restore_audit_log_read_grant.sql', import.meta.url), 'utf8');

test('audit_log read grant is paired with department-permission RLS', () => {
  assert.match(sql, /alter table public\.audit_log enable row level security;/i);
  assert.match(sql, /create policy audit_log_select_authorized\s+on public\.audit_log for select to authenticated/i);
  assert.match(sql, /has_any_department_permission\(\s*department_id,\s*array\['view_audit_log', 'administer_department'\]/i);
  assert.match(sql, /grant select on public\.audit_log to authenticated;/i);
});

test('migration cannot grant writes or change another relation', () => {
  assert.doesNotMatch(sql, /grant\s+(?:all|insert|update|delete)|for\s+(?:all|insert|update|delete)|disable row level security|bypassrls/i);
  const relations = [...sql.matchAll(/(?:table|on)\s+public\.([a-z_]+)/gi)].map(match => match[1]);
  assert.deepEqual([...new Set(relations)], ['audit_log']);
});

test('baseline-drift repair restores the audit_log read boundary without writes', () => {
  assert.match(repairSql, /^\s*begin;/i);
  assert.match(repairSql, /alter table public\.audit_log enable row level security;/i);
  assert.match(repairSql, /create policy audit_log_select_authorized\s+on public\.audit_log for select to authenticated/i);
  assert.match(repairSql, /has_any_department_permission\(\s*department_id,\s*array\['view_audit_log', 'administer_department'\]/i);
  assert.match(repairSql, /grant select on public\.audit_log to authenticated;/i);
  assert.match(repairSql, /commit;\s*$/i);
  assert.doesNotMatch(repairSql, /grant\s+(?:all|insert|update|delete)|for\s+(?:all|insert|update|delete)|disable row level security|bypassrls/i);
  const relations = [...repairSql.matchAll(/(?:table|on)\s+public\.([a-z_]+)/gi)].map(match => match[1]);
  assert.deepEqual([...new Set(relations)], ['audit_log']);
});

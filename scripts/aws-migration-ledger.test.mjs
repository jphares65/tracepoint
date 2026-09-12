import assert from "node:assert/strict";
import test from "node:test";

import { AWS_MIGRATION_LEDGER, loadVerifiedAwsMigrations } from "./aws-migration-ledger.mjs";
import { normalizeMigrationSql } from "./migration-sql-core.mjs";

test("AWS target migration ledger pins every ordered overlay", async () => {
  const migrations = await loadVerifiedAwsMigrations();
  assert.equal(migrations.length, 20);
  assert.deepEqual(migrations.map(item => item.name), AWS_MIGRATION_LEDGER.map(([name]) => name));
});

test("migration SQL normalization is stable across checkout line endings", () => {
  assert.equal(normalizeMigrationSql("\uFEFFselect 1;\r\nselect 2;\r"), "select 1;\nselect 2;\n");
  assert.equal(normalizeMigrationSql("select 1;\nselect 2;\n"), "select 1;\nselect 2;\n");
});

test("AWS-native Fleet and off-duty policies remain permission and tenant bound", async () => {
  const migrations = await loadVerifiedAwsMigrations();
  const sql = migrations.find(item => item.name === "018_fleet_and_off_duty_rls.sql")?.sql ?? "";
  for (const policy of [
    "fleet_rules_read", "fleet_rules_manage", "fleet_vehicles_read", "fleet_vehicles_manage",
    "fleet_work_orders_read", "fleet_work_orders_manage", "fleet_equipment_read", "fleet_equipment_manage",
    "fleet_documents_read", "fleet_documents_manage", "fleet_inspections_read", "fleet_inspections_insert",
    "off_duty_history_read", "off_duty_history_insert",
  ]) assert.match(sql, new RegExp(`create policy ${policy}\\b`));
  assert.match(sql, /has_department_permission\(department_id, 'administer_department'\)/);
  assert.match(sql, /request\.officer_user_id = tracepoint_auth\.subject_id\(\)/);
  assert.doesNotMatch(sql, /(?:using|with check)\s*\(\s*true\s*\)/);
});

test("AWS-native Fleet and off-duty privileges remain authenticated and RLS-scoped", async () => {
  const migrations = await loadVerifiedAwsMigrations();
  const sql = migrations.find(item => item.name === "019_authenticated_fleet_off_duty_privileges.sql")?.sql ?? "";
  for (const table of ["fleet_rules", "fleet_vehicles", "fleet_work_orders", "fleet_vehicle_equipment", "fleet_vehicle_documents", "fleet_vehicle_inspections", "off_duty_firearm_requests", "off_duty_firearm_history"]) {
    assert.match(sql, new RegExp(`public\\.${table}`));
  }
  assert.match(sql, /to authenticated/);
  assert.doesNotMatch(sql, /to (?:anon|service_role|tracepoint_runtime)/);
  assert.doesNotMatch(sql, /grant all/);
});

test("AWS-native off-duty inspection reads remain owner-or-authority bound", async () => {
  const migrations = await loadVerifiedAwsMigrations();
  const sql = migrations.find(item => item.name === "020_off_duty_inspection_rls.sql")?.sql ?? "";
  assert.match(sql, /on public\.off_duty_firearm_inspections for select to authenticated/);
  for (const permission of ["manage_inspections", "manage_firearms", "review_off_duty_requests", "administer_department"]) assert.match(sql, new RegExp(permission));
  assert.match(sql, /request\.officer_user_id = tracepoint_auth\.subject_id\(\)/);
  assert.match(sql, /grant select on table public\.off_duty_firearm_inspections to authenticated/);
  assert.doesNotMatch(sql, /(?:using|with check)\s*\(\s*true\s*\)|grant all|to (?:anon|service_role|tracepoint_runtime)/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("equipment type mutations require management permission and agency scope", async () => {
  const route = await readFile("src/app/api/equipment/types/route.ts", "utf8");
  assert.match(route, /if \(!context\.canManage\) return equipmentPermissionDenied\(\)/);
  assert.match(route, /\.eq\("id", id\)\.eq\("department_id", context\.departmentId\)/);
  assert.match(route, /department_equipment_requirements/);
  assert.match(route, /canArchive: true/);
});

test("equipment type schema trims names, enforces agency-local uniqueness, audits, and preserves assigned-equipment RLS", async () => {
  const migration = await readFile("supabase/migrations/202609030001_range_drill_and_equipment_type_qol.sql", "utf8");
  const auditMigration = await readFile("supabase/migrations/20260826173000_expand_accountability_audit_coverage.sql", "utf8");
  assert.match(migration, /department_id, lower\(btrim\(name\)\)/);
  assert.match(migration, /new\.name := btrim\(new\.name\)/);
  assert.match(migration, /assigned_user_id = auth\.uid\(\)/);
  assert.match(migration, /manage_equipment/);
  assert.match(auditMigration, /'equipment_types'/);
});

test("range drill endpoint requires permission and scopes workspace access to resolved agency", async () => {
  const route = await readFile("src/app/api/pilot/range-workspace/drills/route.ts", "utf8");
  assert.match(route, /hasAnyServerPermission\(resolved\.context, \["manage_range_days"\]\)/);
  assert.match(route, /\.eq\("department_id", departmentId\)/);
  assert.match(route, /audit_events/);
});

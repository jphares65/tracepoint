import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("storage locations are tenant-scoped, normalized, and soft-deactivated", async () => {
  const sql = await readFile("database/aws/034_firearm_storage_location_management.sql", "utf8");
  assert.match(sql, /department_id, lower\(btrim\(name\)\)/);
  assert.match(sql, /where is_active/);
  assert.match(sql, /set is_active=false/);
  assert.match(sql, /department_id=v_department_id/);
  assert.match(sql, /manage_storage_locations/);
});

test("storage location API supports authorized edit and deactivate operations", async () => {
  const route = await readFile("src/app/api/armory/storage-locations/route.ts", "utf8");
  assert.match(route, /export async function PATCH/);
  assert.match(route, /update_firearm_storage_location/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /deactivate_firearm_storage_location/);
  assert.match(route, /manage_storage_locations/);
});

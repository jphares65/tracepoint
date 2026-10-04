import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TRACEPOINT_PERMISSIONS, getRoutePermissionRequirement } from "@/lib/tracepoint/permissions";

test("inventory phase 1 keeps a separate append-only atomic stock ledger", async () => {
  const migration = await readFile("supabase/migrations/202610020002_inventory_phase1.sql", "utf8");
  for (const table of ["inventory_items", "inventory_locations", "inventory_balances", "inventory_transactions"]) assert.match(migration, new RegExp(`create table public\\.${table}`));
  assert.match(migration, /on_hand_quantity numeric\(14,3\) not null default 0 check \(on_hand_quantity >= 0\)/);
  assert.match(migration, /create or replace function public\.record_inventory_transaction/);
  assert.match(migration, /for update/);
  assert.match(migration, /from public\.inventory_items where id = p_item_id and is_active for update/);
  assert.match(migration, /Inventory cannot fall below zero/);
  assert.match(migration, /inventory_transactions_read/);
});

test("inventory has isolated view, management, and adjustment permissions", () => {
  for (const permission of ["view_inventory", "manage_inventory", "adjust_inventory"]) assert.ok(TRACEPOINT_PERMISSIONS.includes(permission as never));
  assert.deepEqual(getRoutePermissionRequirement("/inventory"), { anyOf: ["view_inventory", "manage_inventory", "adjust_inventory"] });
});

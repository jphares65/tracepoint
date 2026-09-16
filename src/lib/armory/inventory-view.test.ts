import assert from "node:assert/strict";
import test from "node:test";
import { matchesFirearmInventorySearch, nextFirearmSort, sortFirearmInventory, toggleFirearmInventoryView } from "./inventory-view.ts";

const firearms = [
  { make: "Glock", model: "19", serial_number: "B-20", firearm_type: "handgun", asset_number: "A-2", condition_status: "In Service", active_assignment: { assigned_to_name: "Taylor" } },
  { make: "Colt", model: "AR15", serial_number: "A-10", firearm_type: "rifle", asset_number: "A-10", condition_status: "Maintenance", active_assignment: null },
];

test("sorts inventory columns in both directions without mutating source data", () => {
  assert.deepEqual(sortFirearmInventory(firearms, "serial", "asc").map((item) => item.serial_number), ["A-10", "B-20"]);
  assert.deepEqual(sortFirearmInventory(firearms, "serial", "desc").map((item) => item.serial_number), ["B-20", "A-10"]);
  assert.deepEqual(firearms.map((item) => item.serial_number), ["B-20", "A-10"]);
});

test("toggles the active sort direction and resets direction for a new column", () => {
  assert.deepEqual(nextFirearmSort("firearm", "asc", "firearm"), { key: "firearm", direction: "desc" });
  assert.deepEqual(nextFirearmSort("firearm", "desc", "status"), { key: "status", direction: "asc" });
});

test("toggles between standard and focus inventory views", () => {
  assert.equal(toggleFirearmInventoryView("standard"), "focus");
  assert.equal(toggleFirearmInventoryView("focus"), "standard");
});

test("preserves existing inventory search fields, including custody", () => {
  assert.equal(matchesFirearmInventorySearch({ ...firearms[0], caliber: "9mm" }, "taylor"), true);
  assert.equal(matchesFirearmInventorySearch({ ...firearms[0], caliber: "9mm" }, "9MM"), true);
  assert.equal(matchesFirearmInventorySearch({ ...firearms[0], caliber: "9mm" }, "missing"), false);
});

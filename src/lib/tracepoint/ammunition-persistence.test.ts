import assert from "node:assert/strict";
import { test } from "node:test";
import { ammunitionWorkspaceForStorage } from "./ammunition-persistence.ts";
import {
  EMPTY_AMMO_WORKSPACE,
  normalizeAmmoWorkspace,
  withLegacyAmmunitionProjection,
  type AmmoLot,
  type AmmoType,
} from "./ammunition-workspace.ts";

const timestamp = "2026-09-23T12:00:00.000Z";
const ammoType: AmmoType = {
  id: "shadow-type-1", name: "SHADOW Validation 9mm", caliber: "9mm",
  category: "Training", purpose: "Synthetic test", unitLabel: "rounds",
  currentOnHand: 1, reorderThreshold: 0, verificationMode: "Manual",
  customIntervalDays: null, nextVerificationDate: "", notes: "", isActive: true,
  createdAt: timestamp, updatedAt: timestamp,
};
const lot: AmmoLot = {
  id: "shadow-lot-1", ammoTypeId: ammoType.id, manufacturer: "Test",
  product: "Synthetic", lotNumber: "SHADOW-ONLY", vendor: "", purchaseDate: "",
  invoiceNumber: "", quantityReceived: 1, quantityRemaining: 1,
  costPerRound: 0, shippingCost: 0, taxCost: 0, totalCost: 0, notes: "",
  createdAt: timestamp, updatedAt: timestamp,
};

function roundTrip(value: unknown) {
  return normalizeAmmoWorkspace(JSON.parse(JSON.stringify(ammunitionWorkspaceForStorage(value))));
}

test("canonical type and lot survive API storage and reload instead of legacy reconstruction", () => {
  const input = withLegacyAmmunitionProjection({
    ...EMPTY_AMMO_WORKSPACE, ammoTypes: [ammoType], lots: [lot],
  });
  const output = roundTrip(input);
  assert.equal(output.ammoTypes.length, 1);
  assert.equal(output.ammoTypes[0].id, ammoType.id);
  assert.equal(output.ammoTypes[0].name, ammoType.name);
  assert.equal(output.lots.length, 1);
  assert.equal(output.lots[0].ammoTypeId, ammoType.id);
  assert.equal(output.lots[0].quantityRemaining, 1);
});

test("multiple canonical types remain distinct and modern metadata outranks legacy projection", () => {
  const second = { ...ammoType, id: "shadow-type-2", name: "SHADOW Validation .45" };
  const input = withLegacyAmmunitionProjection({
    ...EMPTY_AMMO_WORKSPACE, ammoTypes: [ammoType, second], lots: [lot],
  });
  const output = roundTrip(input);
  assert.deepEqual(output.ammoTypes.map((item) => item.id), [ammoType.id, second.id]);
  assert.deepEqual(output.ammoTypes.map((item) => item.name), [ammoType.name, second.name]);
  assert.equal(output.lots[0].ammoTypeId, ammoType.id);
});

test("legacy lot-only workspaces still migrate on read", () => {
  const output = roundTrip({
    dutyLots: [{ id: "legacy-1", caliber: "9mm", quantityOnHand: 2 }],
    trainingLots: [], transactions: [],
  });
  assert.equal(output.ammoTypes.length, 1);
  assert.equal(output.ammoTypes[0].name, "9mm Duty");
  assert.equal(output.lots.length, 1);
});

test("partial canonical workspaces, duplicate IDs, and orphan lots fail closed", () => {
  const base = { ...EMPTY_AMMO_WORKSPACE, ammoTypes: [ammoType], lots: [lot] };
  assert.throws(() => ammunitionWorkspaceForStorage({ ...base, schemaVersion: 1 }));
  assert.throws(() => ammunitionWorkspaceForStorage({ ...base, ammoTypes: [ammoType, ammoType] }));
  assert.throws(() => ammunitionWorkspaceForStorage({ ...base, lots: [{ ...lot, ammoTypeId: "other" }] }));
});

test("storage contract contains no department selector; API tenant scope remains explicit", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../../app/api/pilot/ammunition/route.ts", import.meta.url), "utf8");
  assert.match(route, /resolveServerAccess\(\)/);
  assert.match(route, /hasAnyServerPermission\(context, \["manage_firearms"\]\)/);
  assert.match(route, /const departmentId = context\.departmentId/);
  assert.match(route, /getAmmunition\(departmentId\)/);
  assert.match(route, /department_id: departmentId/);
});

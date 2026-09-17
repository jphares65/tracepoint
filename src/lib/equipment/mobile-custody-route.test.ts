import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = "src/app/api/equipment/custody/route.ts";

test("mobile custody lookup is agency-scoped and exposes a limited asset view", async () => {
  const route = await readFile(routePath, "utf8");

  assert.match(route, /\.eq\("department_id", context\.departmentId\)/);
  assert.match(route, /normalizeIdentifier\(value\) === identifier/);
  assert.match(route, /\.\.\.publicAsset\(item, context\.user\.id\), history/);
  assert.doesNotMatch(
    route.slice(route.indexOf("function publicAsset")),
    /assigned_user_id:\s*item\.assigned_user_id/,
  );
});

test("custody actions preserve condition notes and return a bounded history", async () => {
  const route = await readFile(routePath, "utf8");

  assert.match(route, /VALID_CONDITIONS/);
  assert.match(route, /Only serviceable equipment can be checked out/);
  assert.match(route, /lifecycle_status: condition === "serviceable" \? "active" : "out_of_service"/);
  assert.match(route, /custodyNote\(condition, notes\)/);
  assert.match(route, /equipment_asset_assignments/);
  assert.match(route, /\.limit\(10\)/);
});

test("checkout is atomic and assigns an available active asset only to the caller", async () => {
  const route = await readFile(routePath, "utf8");

  assert.match(route, /assigned_user_id: context\.user\.id/);
  assert.match(route, /\.eq\("lifecycle_status", "active"\)/);
  assert.match(route, /\.is\("assigned_user_id", null\)/);
  assert.match(route, /\.is\("assigned_vehicle_id", null\)/);
  assert.match(route, /\.is\("assigned_location", null\)/);
  assert.match(route, /checked out by someone else/);
});

test("self-service check-in cannot clear another user's custody", async () => {
  const route = await readFile(routePath, "utf8");

  assert.match(route, /asset\.assigned_user_id !== context\.user\.id/);
  assert.match(route, /You can check in only equipment currently assigned to you/);
  assert.match(route, /\.eq\("assigned_user_id", context\.user\.id\)/);
  assert.match(route, /assigned_user_id: null/);
});

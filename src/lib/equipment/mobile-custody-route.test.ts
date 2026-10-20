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

test("aws-native custody transfers use the bounded database function after the route checks", async () => {
  const route = await readFile(routePath, "utf8");
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("async function nativeCustody"));
  const nativeBranch = /if \(process\.env\.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native"\) \{\s*return nativeCustody\(context, id, action, condition, notes\);/g;

  // Both transfers branch only after the availability and holder checks, and
  // before the direct table update that the AWS subject is not permitted.
  assert.equal(post.match(nativeBranch)?.length, 2);
  assert.ok(post.indexOf("not available for checkout") < post.search(nativeBranch));
  const checkIn = post.slice(post.indexOf("You can check in only equipment currently assigned to you"));
  assert.ok(checkIn.search(nativeBranch) < checkIn.indexOf('.from("equipment_assets")'));
  const native = route.slice(route.indexOf("async function nativeCustody"));
  assert.match(native, /rpc\("operate_equipment_self_custody"/);
  assert.match(native, /p_department_id: context\.departmentId/);
  assert.match(native, /p_note: custodyNote\(condition, notes\)/);
  assert.match(native, /checked out by someone else/);
  assert.match(native, /custody changed before check-in completed/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { initialSuperAdminDepartment } from "./super-admin-selection";

const departments = [{ id: "aws-native-acceptance" }, { id: "cedar-hollow" }, { id: "demo-township" }];

test("Super Admin starts on the agency the administrator is working in, not the first listed", () => {
  assert.equal(initialSuperAdminDepartment("", departments, "demo-township"), "demo-township");
});

test("a choice made on the page survives a reload of the entitlements", () => {
  assert.equal(initialSuperAdminDepartment("cedar-hollow", departments, "demo-township"), "cedar-hollow");
});

test("without a listed active agency the first agency is used, and nothing when there are none", () => {
  assert.equal(initialSuperAdminDepartment("", departments, null), "aws-native-acceptance");
  assert.equal(initialSuperAdminDepartment("removed", departments, "also-removed"), "aws-native-acceptance");
  assert.equal(initialSuperAdminDepartment("", [], "demo-township"), "");
});

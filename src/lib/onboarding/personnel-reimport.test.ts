import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validatePersonnel } from "../ai-importer/adapters/personnel.ts";
import { executeApprovedImport } from "../ai-importer/server/execution.ts";
import type { ImportPayload, ImportReferenceData, PreviewRow } from "../ai-importer/types.ts";
import {
  parseImportActive,
  planBridgePersonnelMembership,
  planExistingCognitoPersonnel,
} from "./personnel-reimport.ts";

// Route and server-only modules cannot be imported under node:test, so the
// wiring is guarded in source (as account-access-routes.test.ts does).
const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const route = source("../../app/api/settings/onboarding/personnel/route.ts");
const writer = source("../ai-importer/server/cognito-personnel-writer.ts");
const now = "2026-10-20T00:00:00.000Z";

test("ADM-04: a missing or blank Active value is not read as active", () => {
  for (const value of [undefined, null, "", "   "]) assert.equal(parseImportActive(value), undefined);
  for (const value of ["No", "inactive", "Terminated", false]) assert.equal(parseImportActive(value), false);
  for (const value of ["Yes", "active", true]) assert.equal(parseImportActive(value), true);
});

test("ADM-04 bridge: re-import keeps an existing member's roles and leaves an inactive member inactive", () => {
  const plan = planBridgePersonnelMembership(parseImportActive(""), { is_active: false }, now);
  assert.deepEqual(plan, { active: false, status: {}, assignDefaultRole: false });
  assert.equal(planBridgePersonnelMembership(undefined, { is_active: true }, now).assignDefaultRole, false);
  assert.deepEqual(planBridgePersonnelMembership(undefined, null, now), {
    active: true, status: { is_active: true, deactivated_at: null }, assignDefaultRole: true,
  });
});

test("ADM-04 bridge: an explicit Active value still changes status", () => {
  assert.deepEqual(planBridgePersonnelMembership(false, { is_active: true }, now).status, { is_active: false, deactivated_at: now });
  assert.deepEqual(planBridgePersonnelMembership(true, { is_active: false }, now).status, { is_active: true, deactivated_at: null });
  assert.deepEqual(planBridgePersonnelMembership(false, null, now).status, { is_active: false, deactivated_at: now });
});

test("ADM-04 Cognito: the lifecycle runs only when the import explicitly changes status", () => {
  assert.deepEqual(planExistingCognitoPersonnel(null, { is_active: false }, "active"), { setActive: undefined, resendInvitation: false });
  assert.deepEqual(planExistingCognitoPersonnel(null, { is_active: false }, "pending"), { setActive: undefined, resendInvitation: false });
  assert.equal(planExistingCognitoPersonnel(true, { is_active: true }, "active").setActive, undefined);
  assert.equal(planExistingCognitoPersonnel(false, { is_active: false }, "active").setActive, undefined);
  assert.equal(planExistingCognitoPersonnel(false, { is_active: true }, "active").setActive, false);
  assert.equal(planExistingCognitoPersonnel(true, { is_active: false }, "active").setActive, true);
  // A membership new to this agency keeps the active default (attach inserts it inactive).
  assert.deepEqual(planExistingCognitoPersonnel(null, undefined, "pending"), { setActive: true, resendInvitation: true });
  assert.equal(planExistingCognitoPersonnel(false, undefined, "active").setActive, undefined);
  assert.deepEqual(planExistingCognitoPersonnel(null, { is_active: true }, "pending"), { setActive: undefined, resendInvitation: true });
});

test("ADM-04 classic route: blank Active is passed through unset, and the default role is assigned to new memberships only", () => {
  assert.doesNotMatch(route, /isActiveValue|if \(!normalized\) return true/);
  assert.match(route, /const active = parseImportActive\(body\.active\);/);
  assert.match(route, /active: active \?\? null,/);
  assert.doesNotMatch(route, /is_active: active,/);
  assert.match(route, /\.select\("is_active"\)\s*\.eq\("department_id", departmentId\)\s*\.eq\("user_id", targetUser\.id\)\s*\.maybeSingle\(\);/);
  assert.match(route, /\.\.\.membershipPlan\.status,/);
  assert.match(route, /if \(membershipPlan\.assignDefaultRole\) \{\s*const \{ error: rolesError \} = await server\.rpc\(\s*"set_department_member_roles"/);
});

test("ADM-04 Cognito writer: an existing member's lifecycle is gated on the explicit plan", () => {
  assert.doesNotMatch(writer, /value\.active !== false\) \{\s*await setCognitoMembershipActive/);
  assert.match(writer, /select\("user_id,is_active"\)\.eq\("department_id", departmentId\);[\s\S]*attach_existing_cognito_personnel_import/);
  assert.match(writer, /const plan = planExistingCognitoPersonnel\(value\.active, prior, existingIdentity\.identity_state\);\s*if \(plan\.setActive !== undefined\) \{\s*await setCognitoMembershipActive\(\{[\s\S]*?active: plan\.setActive,/);
  assert.match(writer, /typeof value\.active === "boolean" && row\.changes\.some\(\(change\) => change\.field === "active"\)/);
});

const reference: ImportReferenceData = {
  people: [{ userId: "user-a", fullName: "Pat Separated", email: "pat@example.test", phone: null, badgeNumber: "101", employeeNumber: null, rankTitle: null, unitName: null, active: false }],
  firearms: [], firearmAssignments: [], certificationTypes: [], certifications: [], vehicles: [], fleetEquipment: [], equipmentTypes: [], equipment: [],
};

test("ADM-04 AI importer: an absent Active column produces no status change for an inactive member", () => {
  const [row] = validatePersonnel([{ rowNumber: 2, values: { badgeNumber: "101", fullName: "Pat Separated", email: "pat@example.test", rankTitle: "Sergeant" } }], reference);
  assert.equal(row.action, "UPDATE");
  assert.equal(row.values.active, null);
  assert.equal(row.changes.some((change) => change.field === "active"), false);
  const [explicit] = validatePersonnel([{ rowNumber: 2, values: { badgeNumber: "101", fullName: "Pat Separated", email: "pat@example.test", active: "Active" } }], reference);
  assert.deepEqual(explicit.changes.find((change) => change.field === "active"), { field: "active", label: "Active status", previous: false, next: true });
});

test("ADM-04 AI importer (bridge): an update without Active writes no status and no roles", async () => {
  const calls: Array<{ table: string; method: string; record?: Record<string, unknown> }> = [];
  const query = (table: string) => {
    const chain = {
      insert(record: Record<string, unknown>) { calls.push({ table, method: "insert", record }); return chain; },
      update(record: Record<string, unknown>) { calls.push({ table, method: "update", record }); return chain; },
      upsert(record: Record<string, unknown>) { calls.push({ table, method: "upsert", record }); return chain; },
      eq() { return chain; },
      then(resolve: (value: { data: unknown; error: null }) => unknown) { return Promise.resolve(resolve({ data: null, error: null })); },
    };
    return chain;
  };
  const payload: ImportPayload = {
    file: { name: "roster.csv", size: 1, sha256: "d".repeat(64), type: "text/csv", sheetCount: 1 },
    domain: "personnel", sheetName: "Roster", headerRow: 1, matrix: [["Badge"]], mappings: [],
  };
  const row: PreviewRow = { rowNumber: 2, action: "UPDATE", status: "valid", matchId: "user-a", issues: [], changes: [{ field: "rankTitle", label: "Rank", previous: null, next: "Sergeant" }],
    values: { badgeNumber: "101", fullName: "Pat Separated", email: "pat@example.test", rankTitle: "Sergeant", active: null } };
  const result = await executeApprovedImport({ from: query }, payload, "dept-a", "actor-a", [row]);
  assert.equal(result.failed, 0);
  const membership = calls.find((call) => call.table === "department_memberships");
  assert.ok(membership);
  assert.equal("is_active" in (membership.record ?? {}), false);
  assert.equal("deactivated_at" in (membership.record ?? {}), false);
  assert.equal(calls.some((call) => call.table === "department_membership_roles"), false);
});

test("F1 classic route (bridge): blank rank, unit and employee number are not written over stored values", () => {
  assert.doesNotMatch(route, /rank_title: rankTitle \|\| null,\s*unit_name: unitName \|\| null,\s*employee_number: employeeNumber \|\| null,\s*\.\.\.membershipPlan\.status/);
  assert.match(route, /badge_number: badgeNumber,[\s\S]*\.\.\.\(rankTitle \? \{ rank_title: rankTitle \} : \{\}\),\s*\.\.\.\(unitName \? \{ unit_name: unitName \} : \{\}\),\s*\.\.\.\(employeeNumber \? \{ employee_number: employeeNumber \} : \{\}\),\s*\.\.\.membershipPlan\.status,/);
  // Badge number stays required, so it is never blank here.
  assert.match(route, /if \(!departmentId \|\| !firstName \|\| !lastName \|\| !email \|\| !badgeNumber\)/);
});

test("F1 AI importer (bridge): an update with blank fields does not write them", async () => {
  const calls: Array<{ table: string; record?: Record<string, unknown> }> = [];
  const query = (table: string) => {
    const chain = {
      insert() { return chain; },
      update(record: Record<string, unknown>) { calls.push({ table, record }); return chain; },
      eq() { return chain; },
      then(resolve: (value: { data: unknown; error: null }) => unknown) { return Promise.resolve(resolve({ data: null, error: null })); },
    };
    return chain;
  };
  const payload: ImportPayload = {
    file: { name: "roster.csv", size: 1, sha256: "e".repeat(64), type: "text/csv", sheetCount: 1 },
    domain: "personnel", sheetName: "Roster", headerRow: 1, matrix: [["Badge"]], mappings: [],
  };
  const row: PreviewRow = { rowNumber: 2, action: "UPDATE", status: "valid", matchId: "user-a", issues: [], changes: [{ field: "fullName", label: "Full name", previous: "Pat", next: "Pat Renamed" }],
    values: { badgeNumber: "101", fullName: "Pat Renamed", email: "pat@example.test", phone: "", rankTitle: "", unitName: "", employeeNumber: "", active: null } };
  const result = await executeApprovedImport({ from: query }, payload, "dept-a", "actor-a", [row]);
  assert.equal(result.failed, 0);
  assert.deepEqual(calls.find((call) => call.table === "department_memberships")?.record, { badge_number: "101" });
  assert.equal("phone" in (calls.find((call) => call.table === "profiles")?.record ?? {}), false);
});

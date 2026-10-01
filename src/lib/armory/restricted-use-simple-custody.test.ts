import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sqlPath = "database/aws/031_restricted_firearm_simple_custody.sql";
const routePath = "src/app/api/armory/firearms/[firearmId]/custody/route.ts";
const pagePath = "src/app/firearms/page.tsx";

test("restricted controls are only rendered after a restriction is active", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /selectedRestriction \? \(/);
  assert.match(page, /!selectedRestriction &&/);
});

test("only the dedicated restriction permission can create or remove a restriction", async () => {
  const [sql, route] = await Promise.all([readFile(sqlPath, "utf8"), readFile(routePath, "utf8")]);
  assert.match(sql, /'manage_firearm_restrictions'/);
  assert.match(sql, /not public\.has_department_permission\(v_department_id, 'manage_firearm_restrictions'\)/);
  assert.match(route, /\["manage_firearm_restrictions"\]/);
  assert.doesNotMatch(route, /manage_restrictions", "manage_firearms/);
});

test("no-carry blocks checkout while duty-only yields one state-driven action", async () => {
  const [sql, page] = await Promise.all([readFile(sqlPath, "utf8"), readFile(pagePath, "utf8")]);
  assert.match(sql, /no-carry restriction prohibits checkout/);
  assert.match(page, /RESTRICTED — NO CARRY/);
  assert.match(page, /holder_type === "SECURE_STORAGE".*Check Out/);
  assert.match(page, /holder_type === "OFFICER".*Check In/);
});

test("restricted check-in and checkout preserve assignment and append audit records", async () => {
  const sql = await readFile(sqlPath, "utf8");
  assert.match(sql, /update public\.firearm_current_custody set assignment_id=v_assignment_id/);
  assert.doesNotMatch(sql, /update public\.firearm_assignments/);
  assert.match(sql, /'firearm_checked_out'/);
  assert.match(sql, /'firearm_checked_in'/);
  assert.match(sql, /'restriction_type'/);
});

test("assigned officer self-service does not imply restriction management", async () => {
  const sql = await readFile(sqlPath, "utf8");
  assert.match(sql, /tracepoint_auth\.subject_id\(\) <> v_assignee and not public\.has_department_permission\(v_department_id, 'manage_restricted_firearm_custody'\)/);
  assert.match(sql, /not public\.has_department_permission\(v_department_id, 'manage_firearm_restrictions'\)/);
});

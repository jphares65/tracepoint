import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sqlPath = "database/aws/031_restricted_firearm_simple_custody.sql";
const routePath = "src/app/api/armory/firearms/[firearmId]/custody/route.ts";
const pagePath = "src/app/firearms/page.tsx";

test("restricted use is a contextual custody status with Set and Manage actions", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /Restricted Use/);
  assert.match(page, /selectedRestriction \? "Manage" : "Set"/);
  assert.doesNotMatch(page, /Add restricted-use status/);
});

test("workspace navigation is a single-line capsule rail with an accessible More menu", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /flex min-w-0 items-center gap-1/);
  assert.match(page, /min-h-10 shrink-0 whitespace-nowrap rounded-xl px-2 text-\[11px\] font-bold transition/);
  assert.match(page, /aria-label="More firearm actions"/);
  assert.match(page, /<Ellipsis className="h-4 w-4" aria-hidden="true"/);
  assert.match(page, /role="menu"/);
  assert.doesNotMatch(page, /lg:flex lg:items-center/);
  assert.doesNotMatch(page, /lg:block/);
  assert.doesNotMatch(page, /lg:hidden/);
  assert.match(page, /Restricted"/);
  assert.doesNotMatch(page, />More</);
  assert.match(page, /setWorkspaceTab\("edit"\)/);
  assert.match(page, /setWorkspaceTab\("status"\)/);
  assert.doesNotMatch(page, /overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950\/40 p-1/);
});

test("the authoritative custody card remains available and contains the restricted-use summary", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /workspaceTab === "custody" && \(/);
  assert.match(page, /Current Custody/);
  assert.match(page, /Physical Custody/);
});

test("only the dedicated restriction permission can create or remove a restriction", async () => {
  const [sql, route] = await Promise.all([readFile(sqlPath, "utf8"), readFile(routePath, "utf8")]);
  assert.match(sql, /'manage_firearm_restrictions'/);
  assert.match(sql, /not public\.has_department_permission\(v_department_id, 'manage_firearm_restrictions'\)/);
  assert.match(route, /\["manage_firearm_restrictions"\]/);
  assert.doesNotMatch(route, /manage_restrictions", "manage_firearms/);
});

test("no-carry is unmistakable while duty-only yields one state-driven custody action", async () => {
  const [sql, page] = await Promise.all([readFile(sqlPath, "utf8"), readFile(pagePath, "utf8")]);
  assert.match(sql, /no-carry restriction prohibits checkout/);
  assert.match(page, /NO CARRY — this firearm remains assigned/);
  assert.match(page, /holder_type === "SECURE_STORAGE".*Return to Officer/);
  assert.match(page, /holder_type === "OFFICER".*Check In/);
  assert.doesNotMatch(page, /Custody at a glance/);
  assert.doesNotMatch(page, /Physical custody: \{selectedPhysicalCustody\}/);
});

test("managing a restriction keeps its editable details in the existing restriction API", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /restrictedUseMode === "manage"/);
  assert.match(page, /Administrative notes \(optional\)/);
  assert.match(page, /notes: restrictionNotes \|\| null/);
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

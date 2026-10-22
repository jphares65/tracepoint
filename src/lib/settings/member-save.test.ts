import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseDepartmentMemberSave, saveDepartmentMember } from "./member-save.ts";

// Route and server-only modules cannot be imported under node:test, so the
// wiring is guarded in source (as account-access-routes.test.ts does). The
// transaction behaviour is proven on PostgreSQL in member-save-native.test.ts.
const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const A = "eeeeeeee-0000-4000-8000-00000000000a", officer = "b0000000-0000-4000-8000-0000000000c1";
const valid = { p_department_id: A, p_user_id: officer, p_badge_number: "", p_rank_title: null, p_unit_name: "Patrol", p_employee_number: "E-1", p_is_active: true, p_role_codes: ["officer"], p_group_ids: [] };

test("ADM-20: the save command must carry details, activation, roles and groups", () => {
  assert.deepEqual(parseDepartmentMemberSave(valid), valid);
  assert.equal(parseDepartmentMemberSave({ ...valid, p_is_active: "yes" }), null);
  assert.equal(parseDepartmentMemberSave({ ...valid, p_role_codes: "officer" }), null);
  assert.equal(parseDepartmentMemberSave({ ...valid, p_group_ids: "group" }), null);
  assert.equal(parseDepartmentMemberSave({ ...valid, p_group_ids: [1] }), null);
});

test("E-02: a save without a group list keeps the member's groups", async () => {
  const withoutGroups: Record<string, unknown> = { ...valid };
  delete withoutGroups.p_group_ids;
  const parsed = parseDepartmentMemberSave(withoutGroups);
  assert.equal(parsed?.p_group_ids, null);
  const queries: string[] = [];
  await saveDepartmentMember({ query: async (text) => { queries.push(text); } }, parsed!);
  assert.deepEqual(queries.map((text) => /public\.(\w+)\(/.exec(text)?.[1]), ["update_department_member", "set_department_member_roles"]);
  const route = source("../../app/api/settings/data/route.ts");
  assert.match(route, /p_group_ids === null \? \[\] : \[\["set_department_group_members"/, "bridge mode skips the group call too");
});

test("ADM-20: the three member functions run in order on the caller's connection", async () => {
  const queries: string[] = [];
  await saveDepartmentMember({ query: async (text) => { queries.push(text); } }, parseDepartmentMemberSave(valid)!);
  assert.deepEqual(queries.map((text) => /public\.(\w+)\(/.exec(text)?.[1]), ["update_department_member", "set_department_member_roles", "set_department_group_members"]);
});

test("ADM-20: Settings saves a member with one command, run in one transaction by the route", () => {
  const page = source("../../app/settings/page.tsx");
  const saveMember = page.slice(page.indexOf("async function saveMember()"), page.indexOf("function beginEditRolePermissions("));
  assert.equal(saveMember.match(/dataClient\.rpc\(/g)?.length, 1);
  // E-02: the group list is sent only when the member's groups loaded.
  assert.match(saveMember, /dataClient\.rpc\(\s*"save_department_member",[\s\S]*p_role_codes: memberDraft\.role_codes,[\s\S]*memberGroupsState === "loaded"\s*\? \{ p_group_ids: memberGroupIds \}\s*: \{\}/);
  const route = source("../../app/api/settings/data/route.ts");
  assert.match(route, /if \(change\.linked\) \{\s*await setCognitoMembershipActive\([\s\S]*?client => saveDepartmentMember\(client, save\),/);
  assert.match(route, /\} else \{\s*await withPostgresAuthorization\(getPostgresPool\(\),\s*cognitoInviteAuthorizationContext\(\{ actorUserId: access\.context\.userId, departmentId, supportMode: access\.context\.isSupportMode \}\),\s*client => saveDepartmentMember\(client, save\)\);/);
});

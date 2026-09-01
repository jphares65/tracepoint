import assert from "node:assert/strict";
import test from "node:test";
import { SettingsOverviewAuthorizationError, SettingsOverviewRepositoryConfigurationError, SettingsOverviewRepositoryError, requireSettingsOverviewProvider, TenantBoundSettingsOverviewRepository, type SettingsOverviewDataSource, type SettingsResult, type SettingsRow } from "./overview-repository-core.ts";
import { SupabaseSettingsOverviewDataSource, type SettingsClient, type SettingsQuery } from "./overview-repository-supabase.ts";

const ok = <T>(data: T | null): SettingsResult<T> => ({ data, error: null });
function source(overrides: Partial<SettingsOverviewDataSource> = {}): SettingsOverviewDataSource {
  return {
    async getDepartment() { return ok<SettingsRow>({ id: "agency-a" }); }, async getRules() { return ok<SettingsRow>(null); },
    async getSecurity() { return ok<SettingsRow>(null); }, async listRoles() { return ok<SettingsRow[]>([]); },
    async listPermissions() { return ok([]); }, async listRolePermissions() { return ok([]); },
    async listMemberships() { return ok([]); }, async listMembershipRoles() { return ok([]); },
    async listDepartmentRolePermissions() { return ok([]); }, async listProfiles() { return ok([]); }, ...overrides,
  };
}

test("rejects missing and cross-tenant context before provider access", async () => {
  let calls = 0; const data = source({ async getDepartment() { calls += 1; return ok({}); } });
  assert.throws(() => new TenantBoundSettingsOverviewRepository(data, ""), SettingsOverviewAuthorizationError);
  const repository = new TenantBoundSettingsOverviewRepository(data, "agency-a");
  await assert.rejects(repository.getOverview({ departmentId: "agency-b", canViewSecurity: true, includeSupportMembers: true }), SettingsOverviewAuthorizationError);
  assert.equal(calls, 0);
});

test("retains security and support-member authorization gates", async () => {
  let securityCalls = 0; let membershipCalls = 0;
  const repository = new TenantBoundSettingsOverviewRepository(source({ async getSecurity() { securityCalls += 1; return ok({}); }, async listMemberships() { membershipCalls += 1; return ok([]); } }), "agency-a");
  const result = await repository.getOverview({ departmentId: "agency-a", canViewSecurity: false, includeSupportMembers: false });
  assert.equal(result.security, null); assert.equal(securityCalls, 0); assert.equal(membershipCalls, 0);
});

test("preserves support-mode member aggregation and sorting", async () => {
  const repository = new TenantBoundSettingsOverviewRepository(source({
    async listMemberships() { return ok([{ user_id: "u2", is_active: 1 }, { user_id: "u1", badge_number: "7", is_active: false }]); },
    async listMembershipRoles() { return ok([{ user_id: "u1", role_code: "admin" }, { user_id: "u1", role_code: "officer" }]); },
    async listDepartmentRolePermissions() { return ok([{ role_code: "admin", permission_code: "z" }, { role_code: "officer", permission_code: "a" }]); },
    async listProfiles(ids) { assert.deepEqual(ids, ["u2", "u1"]); return ok([{ id: "u1", full_name: "Able", email: "a@example.test" }]); },
  }), "agency-a");
  const result = await repository.getOverview({ departmentId: "agency-a", canViewSecurity: true, includeSupportMembers: true });
  assert.deepEqual(result.members.map((member) => member.user_id), ["u2", "u1"]);
  assert.deepEqual(result.members[1].role_codes, ["admin", "officer"]); assert.deepEqual(result.members[1].effective_permissions, ["a", "z"]);
});

test("skips empty profile reads and preserves provider error behavior", async () => {
  let profilesCalled = false;
  await new TenantBoundSettingsOverviewRepository(source({ async listProfiles() { profilesCalled = true; return ok([]); } }), "agency-a").getOverview({ departmentId: "agency-a", canViewSecurity: true, includeSupportMembers: true });
  assert.equal(profilesCalled, false);
  const failed = new TenantBoundSettingsOverviewRepository(source({ async getRules(): Promise<SettingsResult<SettingsRow>> { return { data: null, error: { message: "exact provider detail" } }; } }), "agency-a");
  await assert.rejects(failed.getOverview({ departmentId: "agency-a", canViewSecurity: false, includeSupportMembers: false }), (error) => error instanceof SettingsOverviewRepositoryError && error.message === "exact provider detail");
});

test("defaults to Supabase and rejects unsupported providers", () => {
  assert.equal(requireSettingsOverviewProvider(undefined), "supabase");
  assert.throws(() => requireSettingsOverviewProvider("aurora"), SettingsOverviewRepositoryConfigurationError);
});

test("keeps Supabase table, field, tenant, and ordering contracts in the thin adapter", async () => {
  const calls: string[] = [];
  const client: SettingsClient = { from(table) {
    calls.push(`from:${table}`);
    const query = {
      select(fields: string) { calls.push(`select:${fields}`); return query; },
      eq(column: string, value: unknown) { calls.push(`eq:${column}:${String(value)}`); return query; },
      in(column: string, values: string[]) { calls.push(`in:${column}:${values.join(",")}`); return query; },
      order(column: string) { calls.push(`order:${column}`); return query; },
      single() { calls.push("single"); return Promise.resolve(ok<SettingsRow>({})); },
      maybeSingle() { calls.push("maybeSingle"); return Promise.resolve(ok<SettingsRow>(null)); },
      then(resolve: (value: SettingsResult<unknown>) => unknown) { return Promise.resolve(ok<unknown>([])).then(resolve); },
    };
    return query as SettingsQuery;
  } };
  const adapter = new SupabaseSettingsOverviewDataSource(client, client);
  await adapter.getDepartment("agency-a"); await adapter.getRules("agency-a"); await adapter.getSecurity("agency-a");
  await adapter.listRoles(); await adapter.listPermissions(); await adapter.listRolePermissions("agency-a");
  await adapter.listMemberships("agency-a"); await adapter.listMembershipRoles("agency-a");
  await adapter.listDepartmentRolePermissions("agency-a"); await adapter.listProfiles(["u1", "u2"]);
  assert.equal(calls.filter((call) => call === "eq:department_id:agency-a").length, 6);
  assert.ok(calls.includes("from:departments")); assert.ok(calls.includes("eq:id:agency-a"));
  assert.ok(calls.includes("from:department_security_settings")); assert.ok(calls.includes("order:sort_order"));
  assert.ok(calls.includes("in:id:u1,u2"));
});

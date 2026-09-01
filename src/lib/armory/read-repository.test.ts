/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { ArmoryReadAuthorizationError, ArmoryReadRepositoryError, requireArmoryReadProvider, TenantBoundArmoryReadRepository, type ArmoryReadDataSource, type ArmoryResult } from "./read-repository-core.ts";
import { INSPECTION_FIELDS, SupabaseArmoryReadDataSource } from "./read-repository-supabase.ts";
const result = (data: Record<string, unknown>[] = [], error: { message: string } | null = null): ArmoryResult => ({ data, error });
function source(overrides: Partial<ArmoryReadDataSource> = {}): ArmoryReadDataSource { return { listActiveAssignments: async () => result(), listFirearms: async () => result(), listActiveMembers: async () => result(), listProfiles: async () => result(), listAuthUsers: async () => ({ data: { users: [] }, error: null }), listInspections: async () => result(), ...overrides }; }

test("rejects missing and cross-tenant or cross-user context before I/O", async () => {
  assert.throws(() => new TenantBoundArmoryReadRepository(source(), "", "u"), ArmoryReadAuthorizationError);
  let calls = 0; const repository = new TenantBoundArmoryReadRepository(source({ listInspections: async () => { calls += 1; return result(); } }), "dept-a", "u-a");
  await assert.rejects(repository.listInspections({ departmentId: "dept-b", userId: "u-a" }), ArmoryReadAuthorizationError);
  await assert.rejects(repository.listInspections({ departmentId: "dept-a", userId: "u-b" }), ArmoryReadAuthorizationError);
  assert.equal(calls, 0);
});

test("preserves self-only firearm visibility, member mapping, defaults, and access response", async () => {
  const observed: unknown[] = [];
  const repository = new TenantBoundArmoryReadRepository(source({
    listActiveAssignments: async (departmentId, userId) => { observed.push([departmentId, userId]); return result([{ id: "a", firearm_id: "f", assigned_to_user_id: "u" }]); },
    listFirearms: async (departmentId, input) => { observed.push([departmentId, input]); return result([{ id: "f", condition_status: null }]); },
    listActiveMembers: async () => result([{ user_id: "u", rank_title: "Officer", badge_number: "7" }]),
    listProfiles: async () => result([{ id: "u", full_name: "Alex", email: "profile@example.test" }]),
    listAuthUsers: async () => ({ data: { users: [{ id: "u", email: "auth@example.test" }] }, error: null }),
  }), "dept", "u");
  const data = await repository.getFirearmInventory({ departmentId: "dept", userId: "u", includeArchived: true, canViewAll: false, canManage: false, canInspect: false });
  assert.deepEqual(observed, [["dept", "u"], ["dept", { includeArchived: false, firearmIds: ["f"] }]]);
  assert.deepEqual(data.firearms[0], { id: "f", condition_status: "In Service", active_assignment: { id: "a", firearm_id: "f", assigned_to_user_id: "u", assigned_to_name: "Alex" } });
  assert.deepEqual(data.members, []); assert.deepEqual(data.access, { canViewAll: false, canManage: false, canInspect: false });
});

test("skips firearm and profile queries for empty self scope and preserves errors", async () => {
  let firearmCalls = 0; let profileCalls = 0;
  const repository = new TenantBoundArmoryReadRepository(source({ listFirearms: async () => { firearmCalls += 1; return result(); }, listProfiles: async () => { profileCalls += 1; return result(); } }), "dept", "u");
  const data = await repository.getFirearmInventory({ departmentId: "dept", userId: "u", includeArchived: false, canViewAll: false, canManage: false, canInspect: false });
  assert.deepEqual(data.firearms, []); assert.equal(firearmCalls, 0); assert.equal(profileCalls, 0);
  const failed = new TenantBoundArmoryReadRepository(source({ listInspections: async () => result([], { message: "inspection failed" }) }), "dept", "u");
  await assert.rejects(failed.listInspections({ departmentId: "dept", userId: "u" }), (error: unknown) => error instanceof ArmoryReadRepositoryError && error.message === "inspection failed");
});

test("preserves exact Supabase query contracts", async () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const query: any = { select: (v: string) => (calls.push(["select", v]), query), eq: (c: string, v: unknown) => (calls.push(["eq", c, v]), query), is: (c: string, v: null) => (calls.push(["is", c, v]), query), in: (c: string, v: string[]) => (calls.push(["in", c, v]), query), order: (c: string, v?: unknown) => (calls.push(["order", c, v]), query), limit: (v: number) => (calls.push(["limit", v]), query), then: (resolve: (value: ArmoryResult) => void) => resolve(result()) };
  const adapter = new SupabaseArmoryReadDataSource({ from: (table: string) => (calls.push(["from", table]), query) }, { auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } } });
  await adapter.listActiveAssignments("dept", "u"); await adapter.listFirearms("dept", { includeArchived: false, firearmIds: ["f"] }); await adapter.listActiveMembers("dept"); await adapter.listProfiles(["u"]); await adapter.listInspections("dept");
  assert.ok(calls.some((call) => call[0] === "select" && call[1] === INSPECTION_FIELDS)); assert.ok(calls.some((call) => call[0] === "limit" && call[1] === 100));
  assert.equal(calls.filter((call) => call[0] === "eq" && call[1] === "department_id" && call[2] === "dept").length, 4);
  assert.ok(calls.some((call) => call[0] === "in" && call[1] === "id")); assert.ok(calls.some((call) => call[0] === "is" && call[1] === "returned_at"));
});

test("defaults to Supabase and fails closed", () => { assert.equal(requireArmoryReadProvider(undefined), "supabase"); assert.throws(() => requireArmoryReadProvider("aurora"), /Unsupported data provider/); });

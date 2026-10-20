/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { ArmoryReadAuthorizationError, ArmoryReadRepositoryError, requireArmoryReadProvider, TenantBoundArmoryReadRepository, type ArmoryReadDataSource, type ArmoryResult } from "./read-repository-core.ts";
import { INSPECTION_FIELDS, SupabaseArmoryReadDataSource } from "./read-repository-supabase.ts";
const result = (data: Record<string, unknown>[] = [], error: { message: string } | null = null): ArmoryResult => ({ data, error });
function source(overrides: Partial<ArmoryReadDataSource> = {}): ArmoryReadDataSource { return { listActiveAssignments: async () => result(), listFirearms: async () => result(), listActiveMembers: async () => result(), listInactiveMembers: async () => result(), listProfiles: async () => result(), listAuthUsers: async () => ({ data: { users: [] }, error: null }), listInspections: async () => result(), ...overrides }; }

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
    listActiveMembers: async () => result([{ user_id: "u", rank_title: "Officer", badge_number: "7", unit_name: "Patrol" }]),
    listProfiles: async () => result([{ id: "u", full_name: "Alex", email: "profile@example.test" }]),
    listAuthUsers: async () => ({ data: { users: [{ id: "u", email: "auth@example.test" }] }, error: null }),
  }), "dept", "u");
  const data = await repository.getFirearmInventory({ departmentId: "dept", userId: "u", includeArchived: true, canViewAll: false, canManage: false, canInspect: false });
  assert.deepEqual(observed, [["dept", "u"], ["dept", { includeArchived: false, firearmIds: ["f"] }]]);
  assert.deepEqual(data.firearms[0], { id: "f", condition_status: "In Service", active_assignment: { id: "a", firearm_id: "f", assigned_to_user_id: "u", assigned_to_name: "Alex", assigned_to_badge_number: "7", assigned_to_unit_name: "Patrol" } });
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

test("ARM-08 display: a firearm held by a separated member names that holder, marked inactive, not Unknown User", async () => {
  const inactiveInputs: unknown[] = []; const profileInputs: unknown[] = [];
  const repository = new TenantBoundArmoryReadRepository(source({
    listActiveAssignments: async () => result([{ id: "a1", firearm_id: "f1", assigned_to_user_id: "active" }, { id: "a2", firearm_id: "f2", assigned_to_user_id: "gone" }]),
    listFirearms: async () => result([{ id: "f1", condition_status: "In Service" }, { id: "f2", condition_status: "In Service" }]),
    listActiveMembers: async () => result([{ user_id: "active", badge_number: "1" }]),
    listInactiveMembers: async (departmentId, userIds) => { inactiveInputs.push([departmentId, userIds]); return result([{ user_id: "gone", badge_number: "44", unit_name: "Patrol" }]); },
    listProfiles: async (userIds) => { profileInputs.push(userIds); return result([{ id: "active", full_name: "Alex Active" }, { id: "gone", full_name: "Sam Separated" }]); },
  }), "dept", "admin");
  const data = await repository.getFirearmInventory({ departmentId: "dept", userId: "admin", includeArchived: false, canViewAll: true, canManage: true, canInspect: false });
  assert.deepEqual(inactiveInputs, [["dept", ["gone"]]]);
  assert.deepEqual(profileInputs, [["active", "gone"]]);
  const held = (data.firearms as Record<string, any>[]).find((firearm) => firearm.id === "f2")?.active_assignment as Record<string, unknown>;
  assert.equal(held.assigned_to_name, "Sam Separated (inactive)");
  assert.equal(held.assigned_to_badge_number, "44");
  assert.equal(held.assigned_to_is_active, false);
  assert.equal(((data.firearms as Record<string, any>[]).find((firearm) => firearm.id === "f1")?.active_assignment as Record<string, unknown>).assigned_to_name, "Alex Active");
  // The assignable member list stays active-only.
  assert.deepEqual(data.members.map((member) => member.user_id), ["active"]);
});

test("B8a Unknown User: on AWS an armorer who cannot read profiles sees the holder's name from the identity lookup, without email", async () => {
  const { PostgresArmoryReadDataSource } = await import("./read-repository-postgres.ts");
  // What AWS RLS returns to an armorer with manage_firearms only: their own
  // membership and profile; firearms and assignments of the agency.
  const tables: Record<string, Record<string, unknown>[]> = {
    department_memberships: [{ department_id: "dept", user_id: "armorer", is_active: true, rank_title: null, badge_number: "1", unit_name: null }],
    profiles: [{ id: "armorer", full_name: "Avery Armorer", email: "armorer@example.test" }],
    firearm_assignments: [{ id: "a", department_id: "dept", firearm_id: "f", assigned_to_user_id: "officer", returned_at: null }],
    firearms: [{ id: "f", department_id: "dept", is_active: true, condition_status: "In Service" }],
  };
  const rpcs: unknown[] = [];
  const client = {
    from(table: string) {
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      const builder: any = {
        select: () => builder, order: () => builder, limit: () => builder,
        eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
        is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
        in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
        then: (resolve: any) => resolve(result((tables[table] ?? []).filter((row) => filters.every((filter) => filter(row))))),
      };
      return builder;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push([name, args]);
      return result([
        { user_id: "armorer", full_name: "Avery Armorer", rank_title: null, badge_number: "1", unit_name: null, is_active: true },
        { user_id: "officer", full_name: "Olive Officer", rank_title: "Officer", badge_number: "4410", unit_name: "Patrol", is_active: true },
      ]);
    },
  };
  const repository = new TenantBoundArmoryReadRepository(new PostgresArmoryReadDataSource(client as any), "dept", "armorer");
  const data = await repository.getFirearmInventory({ departmentId: "dept", userId: "armorer", includeArchived: false, canViewAll: true, canManage: true, canInspect: true });
  const assignment = data.firearms[0].active_assignment as any;
  assert.equal(assignment.assigned_to_name, "Olive Officer");
  assert.equal(assignment.assigned_to_badge_number, "4410");
  const officer = data.members.find((member) => member.user_id === "officer");
  assert.equal(officer?.full_name, "Olive Officer");
  assert.equal(officer?.email, "");
  assert.equal(data.members.find((member) => member.user_id === "armorer")?.email, "armorer@example.test");
  assert.deepEqual(rpcs, [["armory_member_identities", { p_department_id: "dept" }]]);
});

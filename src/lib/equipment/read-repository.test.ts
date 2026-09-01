import assert from "node:assert/strict";
import test from "node:test";

import {
  EquipmentReadAuthorizationError,
  EquipmentReadRepositoryConfigurationError,
  EquipmentReadRepositoryError,
  requireEquipmentReadProvider,
  TenantBoundEquipmentReadRepository,
  type EquipmentReadDataSource,
} from "./read-repository-core.ts";
import {
  SupabaseEquipmentReadDataSource,
  type EquipmentReadSupabaseClient,
  type EquipmentReadQuery,
} from "./read-repository-supabase.ts";

function client(
  results: Record<string, { data: unknown; error: { message: string } | null }>,
  calls: string[],
): EquipmentReadSupabaseClient {
  return {
    from(table: string) {
      calls.push(`from:${table}`);
      const chain = {
        select(fields: string) { calls.push(`select:${fields}`); return chain; },
        eq(column: string, value: unknown) { calls.push(`eq:${column}:${String(value)}`); return chain; },
        in(column: string, value: unknown[]) { calls.push(`in:${column}:${value.join(",")}`); return chain; },
        order(column: string, options?: { ascending?: boolean }) {
          calls.push(`order:${column}:${options?.ascending === false ? "desc" : "asc"}`);
          return chain;
        },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(results[table]).then(resolve); },
      };
      return chain as EquipmentReadQuery;
    },
  };
}

function source(overrides: Partial<EquipmentReadDataSource> = {}): EquipmentReadDataSource {
  return {
    async listTypes() { return []; },
    async listAssets() { return []; },
    async listActiveMembers() { return []; },
    async listProfiles() { return []; },
    async listRequirements() { return []; },
    ...overrides,
  };
}

test("preserves tenant filters, projections, visibility filtering, and ordering", async () => {
  const calls: string[] = [];
  const adapter = new SupabaseEquipmentReadDataSource(client({
    equipment_types: { data: [], error: null },
    equipment_assets: { data: [], error: null },
    department_memberships: { data: [], error: null },
    profiles: { data: [], error: null },
    department_equipment_requirements: { data: [], error: null },
  }, calls));

  await adapter.listTypes("agency-a");
  await adapter.listAssets({ departmentId: "agency-a", assignedUserId: "user-a" });
  await adapter.listActiveMembers("agency-a");
  await adapter.listProfiles(["user-a", "user-b"]);
  await adapter.listRequirements("agency-a");

  assert.deepEqual(calls, [
    "from:equipment_types", "select:*", "eq:department_id:agency-a", "order:category:asc", "order:name:asc",
    "from:equipment_assets", "select:*", "eq:department_id:agency-a", "order:created_at:desc", "eq:assigned_user_id:user-a",
    "from:department_memberships", "select:user_id,badge_number,rank_title,unit_name,is_active", "eq:department_id:agency-a", "eq:is_active:true",
    "from:profiles", "select:id,full_name", "in:id:user-a,user-b",
    "from:department_equipment_requirements", "select:*", "eq:department_id:agency-a", "order:created_at:asc",
  ]);
});

test("rejects missing and cross-tenant context before provider access", async () => {
  let calls = 0;
  const dataSource = source({ async listTypes() { calls += 1; return []; } });
  assert.throws(() => new TenantBoundEquipmentReadRepository(dataSource, ""), EquipmentReadAuthorizationError);
  const repository = new TenantBoundEquipmentReadRepository(dataSource, "agency-a");
  await assert.rejects(repository.listTypes({ departmentId: "" }), EquipmentReadAuthorizationError);
  await assert.rejects(repository.listTypes({ departmentId: "agency-b" }), EquipmentReadAuthorizationError);
  await assert.rejects(repository.getAssetDirectory({ departmentId: "agency-a", userId: "", canViewDepartment: false }), EquipmentReadAuthorizationError);
  assert.equal(calls, 0);
});

test("limits non-department viewers and preserves member display fallbacks", async () => {
  const assetInputs: unknown[] = [];
  const repository = new TenantBoundEquipmentReadRepository(source({
    async listAssets(input) { assetInputs.push(input); return [{ id: "asset-a" }]; },
    async listActiveMembers() {
      return [
        { user_id: "user-a", badge_number: "17", rank_title: "Officer", unit_name: null },
        { user_id: "user-b", rank_title: "Sergeant" },
        { user_id: "user-c" },
      ];
    },
    async listProfiles() { return [{ id: "user-a", full_name: "  Alex Able  " }]; },
  }), "agency-a");

  const result = await repository.getAssetDirectory({ departmentId: "agency-a", userId: "user-a", canViewDepartment: false });
  assert.deepEqual(assetInputs, [{ departmentId: "agency-a", assignedUserId: "user-a" }]);
  assert.deepEqual(result, {
    items: [{ id: "asset-a" }],
    members: [
      { userId: "user-a", fullName: "Alex Able", badgeNumber: "17", rankTitle: "Officer", unitName: null },
      { userId: "user-b", fullName: "Sergeant", badgeNumber: null, rankTitle: "Sergeant", unitName: null },
      { userId: "user-c", fullName: "Unnamed Officer", badgeNumber: null, rankTitle: null, unitName: null },
    ],
  });
});

test("returns unassigned laptop, radio, and vest rows to an authorized department viewer", async () => {
  const createdRows = [
    { id: "laptop", equipment_type_id: "type-laptop", assigned_user_id: null, lifecycle_status: "active" },
    { id: "radio", equipment_type_id: "type-radio", assigned_user_id: null, lifecycle_status: "active" },
    { id: "vest", equipment_type_id: "type-vest", assigned_user_id: null, lifecycle_status: "out_of_service" },
  ];
  const inputs: unknown[] = [];
  const repository = new TenantBoundEquipmentReadRepository(source({
    async listAssets(input) { inputs.push(input); return createdRows; },
  }), "agency-a");

  const result = await repository.getAssetDirectory({
    departmentId: "agency-a",
    userId: "chief-a",
    canViewDepartment: true,
  });

  assert.deepEqual(inputs, [{ departmentId: "agency-a", assignedUserId: undefined }]);
  assert.deepEqual(result.items, createdRows);
});

test("skips profile access for an empty member set and preserves empty results", async () => {
  let profilesCalled = false;
  const repository = new TenantBoundEquipmentReadRepository(source({
    async listProfiles() { profilesCalled = true; return []; },
  }), "agency-a");
  assert.deepEqual(await repository.listTypes({ departmentId: "agency-a" }), []);
  assert.deepEqual(await repository.listRequirements({ departmentId: "agency-a" }), []);
  assert.deepEqual(await repository.getAssetDirectory({ departmentId: "agency-a", userId: "user-a", canViewDepartment: true }), { items: [], members: [] });
  assert.equal(profilesCalled, false);
});

test("maps provider failures without leaking provider details", async () => {
  const adapter = new SupabaseEquipmentReadDataSource(client({
    equipment_types: { data: null, error: { message: "synthetic relation detail" } },
  }, []));
  await assert.rejects(adapter.listTypes("agency-a"), (error) =>
    error instanceof EquipmentReadRepositoryError && !error.message.includes("relation"));
});

test("defaults to Supabase and rejects unsupported provider configuration", () => {
  assert.equal(requireEquipmentReadProvider(undefined), "supabase");
  assert.equal(requireEquipmentReadProvider(" SUPABASE "), "supabase");
  assert.throws(
    () => requireEquipmentReadProvider("aurora"),
    EquipmentReadRepositoryConfigurationError,
  );
});

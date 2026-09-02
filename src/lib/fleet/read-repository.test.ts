import assert from "node:assert/strict";
import test from "node:test";

import {
  FleetReadAuthorizationError,
  FleetReadRepositoryError,
  requireFleetReadProvider,
  TenantBoundFleetReadRepository,
  type FleetReadDataSource,
  type FleetResult,
} from "./read-repository-core.ts";
import {
  SupabaseFleetReadDataSource,
  type FleetClient,
} from "./read-repository-supabase.ts";

const ok = (data: unknown): FleetResult => ({ data, error: null });

function source(overrides: Partial<FleetReadDataSource> = {}) {
  const empty = () => Promise.resolve(ok([]));
  return {
    getRules: () => Promise.resolve(ok(null)),
    listVehicles: empty,
    getVehicle: () => Promise.resolve(ok(null)),
    listWorkOrders: empty,
    listEquipment: empty,
    listDocuments: empty,
    listInspections: empty,
    listHistory: empty,
    listProfiles: empty,
    ...overrides,
  } satisfies FleetReadDataSource;
}

test("fleet reads reject missing and mismatched tenant context before provider I/O", async () => {
  let calls = 0;
  const dataSource = source({
    listVehicles: () => {
      calls += 1;
      return Promise.resolve(ok([]));
    },
  });
  assert.throws(
    () => new TenantBoundFleetReadRepository(dataSource, ""),
    FleetReadAuthorizationError,
  );
  const repository = new TenantBoundFleetReadRepository(dataSource, "dept-a");
  await assert.rejects(
    repository.getVehicleList({ departmentId: "dept-b", vehicleFields: "id" }),
    FleetReadAuthorizationError,
  );
  await assert.rejects(
    repository.getVehicleDetail({
      departmentId: "dept-a",
      vehicleId: "",
      canViewNetworkDetails: () => false,
    }),
    FleetReadAuthorizationError,
  );
  assert.equal(calls, 0);
});

test("fleet vehicle list preserves rows, empty data, and provider errors", async () => {
  const repository = new TenantBoundFleetReadRepository(
    source({
      getRules: () => Promise.resolve(ok({ fleet_manager_role_codes: ["chief"] })),
      listVehicles: () => Promise.resolve(ok([{ id: "vehicle-1" }])),
    }),
    "dept-a",
  );
  assert.deepEqual(
    await repository.getVehicleList({ departmentId: "dept-a", vehicleFields: "id" }),
    {
      rules: { fleet_manager_role_codes: ["chief"] },
      items: [{ id: "vehicle-1" }],
    },
  );

  const failing = new TenantBoundFleetReadRepository(
    source({
      listVehicles: () =>
        Promise.resolve({ data: null, error: { message: "unavailable", code: "PGRST205" } }),
    }),
    "dept-a",
  );
  await assert.rejects(
    failing.getVehicleList({ departmentId: "dept-a", vehicleFields: "id" }),
    (error: unknown) =>
      error instanceof FleetReadRepositoryError &&
      error.message === "unavailable" &&
      error.code === "PGRST205",
  );
});

test("fleet detail preserves mapping, ignored related errors, and network masking", async () => {
  const repository = new TenantBoundFleetReadRepository(
    source({
      getVehicle: () => Promise.resolve(ok({ id: "vehicle-1" })),
      listWorkOrders: () => Promise.resolve({ data: null, error: { message: "ignored" } }),
      listEquipment: () => Promise.resolve(ok([{ id: "equipment-1", static_ip: "10.0.0.1" }])),
      listInspections: () => Promise.resolve(ok([
        { id: "inspection-1", inspector_user_id: "user-1" },
        { id: "inspection-2", inspector_user_id: null },
      ])),
      listHistory: () => Promise.resolve(ok([{ id: "event-1", actor_user_id: "missing" }])),
      listProfiles: (ids) => {
        assert.deepEqual(ids, ["user-1", "missing"]);
        return Promise.resolve(ok([{ id: "user-1", full_name: "  Fleet Officer  " }]));
      },
    }),
    "dept-a",
  );
  const detail = await repository.getVehicleDetail({
    departmentId: "dept-a",
    vehicleId: "vehicle-1",
    canViewNetworkDetails: () => false,
  });
  assert.deepEqual(detail?.workOrders, []);
  assert.deepEqual(detail?.equipment, [{ id: "equipment-1", static_ip: null }]);
  assert.equal(detail?.inspections[0].inspector_name, "Fleet Officer");
  assert.equal(detail?.inspections[1].inspector_name, "System / legacy record");
  assert.equal(detail?.history[0].actor_name, "Unknown user");
});

test("fleet detail returns not-found and fails on the primary vehicle error", async () => {
  const missing = new TenantBoundFleetReadRepository(source(), "dept-a");
  assert.equal(
    await missing.getVehicleDetail({
      departmentId: "dept-a",
      vehicleId: "missing",
      canViewNetworkDetails: () => true,
    }),
    null,
  );
  const failing = new TenantBoundFleetReadRepository(
    source({
      getVehicle: () => Promise.resolve({ data: null, error: { message: "vehicle failed" } }),
    }),
    "dept-a",
  );
  await assert.rejects(
    failing.getVehicleDetail({
      departmentId: "dept-a",
      vehicleId: "vehicle-1",
      canViewNetworkDetails: () => true,
    }),
    /vehicle failed/,
  );
});

test("Supabase fleet adapter preserves exact tables, filters, fields, order, and limits", async () => {
  const calls: string[] = [];
  const query = new Proxy(
    { then: (resolve: (value: FleetResult) => void) => resolve(ok([])) },
    {
      get(target, property) {
        if (property === "then") return target.then;
        return (...args: unknown[]) => {
          calls.push(`${String(property)}:${JSON.stringify(args)}`);
          return query;
        };
      },
    },
  );
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      return query;
    },
  } as unknown as FleetClient;
  const adapter = new SupabaseFleetReadDataSource(client);
  await adapter.getRules("dept-a", "*");
  await adapter.listVehicles("dept-a", "id,unit_number");
  await adapter.getVehicle("dept-a", "vehicle-1");
  await adapter.listWorkOrders("dept-a", "vehicle-1");
  await adapter.listEquipment("dept-a", "vehicle-1");
  await adapter.listDocuments("dept-a", "vehicle-1");
  await adapter.listInspections("dept-a", "vehicle-1");
  await adapter.listHistory("dept-a", "vehicle-1");
  await adapter.listProfiles(["user-1"]);
  assert.deepEqual(calls, [
    "from:fleet_rules", 'select:["*"]', 'eq:["department_id","dept-a"]', "maybeSingle:[]",
    "from:fleet_vehicles", 'select:["id,unit_number"]', 'eq:["department_id","dept-a"]', 'order:["unit_number",{"ascending":true}]',
    "from:fleet_vehicles", 'select:["*"]', 'eq:["department_id","dept-a"]', 'eq:["id","vehicle-1"]', "maybeSingle:[]",
    "from:fleet_work_orders", 'select:["*"]', 'eq:["department_id","dept-a"]', 'eq:["vehicle_id","vehicle-1"]', 'order:["reported_at",{"ascending":false}]',
    "from:fleet_vehicle_equipment", 'select:["*"]', 'eq:["department_id","dept-a"]', 'eq:["vehicle_id","vehicle-1"]', 'order:["category"]',
    "from:fleet_vehicle_documents", 'select:["*"]', 'eq:["department_id","dept-a"]', 'eq:["vehicle_id","vehicle-1"]', 'order:["created_at",{"ascending":false}]',
    "from:fleet_vehicle_inspections", 'select:["*"]', 'eq:["department_id","dept-a"]', 'eq:["vehicle_id","vehicle-1"]', 'order:["inspected_at",{"ascending":false}]', "limit:[100]",
    "from:audit_events", 'select:["id,action,details,actor_user_id,created_at"]', 'eq:["department_id","dept-a"]', 'eq:["entity_type","fleet_vehicle"]', 'eq:["entity_id","vehicle-1"]', 'order:["created_at",{"ascending":false}]', "limit:[100]",
    "from:profiles", 'select:["id,full_name"]', 'in:["id",["user-1"]]',
  ]);
});

test("fleet provider selection fails closed", () => {
  assert.equal(requireFleetReadProvider(undefined), "supabase");
  assert.throws(() => requireFleetReadProvider("aurora"), /Unsupported data provider/);
});

/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Handler-level tests for B9 (EQP-01, EQP-04, EQP-12): the equipment asset route
// runs unchanged against an in-memory data client; only the session resolver and
// the server-only marker are replaced (as in fleet-integrity.test.ts).
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__equipmentAccess,
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  hasAnyServerPermission: (context: any, permissions: string[]) => permissions.some((permission) => context.permissions.includes(permission)),
  requireServerFeature: () => null,
});

type Row = Record<string, any>;
function createDb(tables: Record<string, Row[]>) {
  const updates: Row[] = [];
  function from(table: string) {
    tables[table] ??= [];
    const filters: ((row: Row) => boolean)[] = [];
    let op = "select"; let payload: any = null; let single: "one" | "maybe" | null = null;
    const builder: any = {
      select() { return builder; },
      eq(column: string, value: any) { filters.push((row) => String(row[column]) === String(value)); return builder; },
      neq(column: string, value: any) { filters.push((row) => row[column] !== value); return builder; },
      in(column: string, values: any[]) { filters.push((row) => values.includes(row[column])); return builder; },
      order() { return builder; },
      maybeSingle() { single = "maybe"; return builder; },
      single() { single = "one"; return builder; },
      insert(value: any) { op = "insert"; payload = value; return builder; },
      update(value: any) { op = "update"; payload = value; return builder; },
      then(resolve: any, reject: any) { return Promise.resolve(run()).then(resolve, reject); },
    };
    function run() {
      const rows = tables[table];
      if (op === "insert") { const row = { id: `${table}-${rows.length + 1}`, ...payload }; rows.push(row); return { data: row, error: null }; }
      const matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (op === "update") { updates.push({ table, ...payload }); for (const row of matched) Object.assign(row, payload); }
      const data = matched.map((row) => ({ ...row }));
      if (single === "one") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: "not one row" } };
      if (single === "maybe") return { data: data[0] ?? null, error: null };
      return { data, error: null };
    }
    return builder;
  }
  return { from, tables, updates };
}

const D = "dept-1";
const ACTIVE = "user-active";
const GONE = "user-separated";
const asset = (over: Row = {}) => ({
  id: "asset-1", department_id: D, equipment_type_id: "type-1", lifecycle_status: "active",
  assigned_user_id: GONE, assigned_vehicle_id: null, assigned_location: null,
  issue_date: "2026-01-01", expiration_date: "2031-01-01", removal_reason: null, removed_at: null, removed_by: null, ...over,
});
function world(assets: Row[] = [asset()]) {
  const db = createDb({
    equipment_assets: assets,
    equipment_types: [{ id: "type-1", department_id: D, is_active: true }],
    department_memberships: [
      { department_id: D, user_id: ACTIVE, is_active: true, badge_number: "1" },
      { department_id: D, user_id: GONE, is_active: false, badge_number: "44", deactivated_at: "2026-10-01T12:00:00Z" },
    ],
    profiles: [{ id: ACTIVE, full_name: "Alex Active" }, { id: GONE, full_name: "Sam Separated" }],
    fleet_vehicles: [{ id: "vehicle-retired", department_id: D, unit_number: "9", status: "Retired" }],
  });
  (globalThis as any).__equipmentAccess = { ok: true, context: { admin: db, db, departmentId: D, user: { id: "quartermaster" }, permissions: ["manage_equipment"] } };
  return db;
}

async function load() {
  const { NextRequest } = await import("next/server");
  const route = await import("../../app/api/equipment/assets/route.ts");
  const call = async (method: "GET" | "POST" | "PATCH", body?: unknown) => {
    const request = new NextRequest("http://localhost/api/equipment/assets", { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
    const response = await (route as any)[method](request);
    return { status: response.status, body: await response.json() };
  };
  return { call };
}

test("EQP-01: the asset list names a separated holder (inactive) and keeps them out of the assignable members", async () => {
  const { call } = await load();
  world();
  const result = await call("GET");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.members.map((member: Row) => member.userId), [ACTIVE]);
  assert.equal(result.body.inactiveHolders.length, 1);
  assert.equal(result.body.inactiveHolders[0].userId, GONE);
  assert.equal(result.body.inactiveHolders[0].fullName, "Sam Separated");
  assert.equal(result.body.inactiveHolders[0].isActive, false);
});

test("EQP-04: an item held by a separated member can be marked out of service with a reason; custody is not rewritten", async () => {
  const { call } = await load();
  const db = world();
  const result = await call("PATCH", { id: "asset-1", lifecycleStatus: "out_of_service", removalReason: "Not returned at separation" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const update = db.updates.at(-1)!;
  assert.equal(update.lifecycle_status, "out_of_service");
  assert.equal(update.removal_reason, "Not returned at separation");
  // The holder stays attributed and the custody columns are not in the update.
  assert.equal("assigned_user_id" in update, false);
  assert.equal(db.tables.equipment_assets[0].assigned_user_id, GONE);
});

test("EQP-04: removing an item held by a separated member clears custody explicitly so history closes", async () => {
  const { call } = await load();
  const db = world();
  const result = await call("PATCH", { id: "asset-1", lifecycleStatus: "removed", removalReason: "Lost - not returned" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const update = db.updates.at(-1)!;
  assert.equal(update.assigned_user_id, null);
  assert.equal(update.removal_reason, "Lost - not returned");
  assert.equal(update.lifecycle_status, "removed");
});

test("EQP-04: an item held by a separated member can be returned (unassigned)", async () => {
  const { call } = await load();
  const db = world();
  const result = await call("PATCH", { id: "asset-1", assignedUserId: "", assignedLocation: "Quartermaster" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(db.updates.at(-1)!.assigned_user_id, null);
  assert.equal(db.updates.at(-1)!.assigned_location, "Quartermaster");
});

test("EQP-04: an item on a retired vehicle can be marked out of service", async () => {
  const { call } = await load();
  world([asset({ assigned_user_id: null, assigned_vehicle_id: "vehicle-retired" })]);
  const result = await call("PATCH", { id: "asset-1", lifecycleStatus: "out_of_service", removalReason: "Vehicle retired" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
});

test("EQP-04: a NEW assignment to a separated member is still refused (create and edit)", async () => {
  const { call } = await load();
  world([asset({ assigned_user_id: ACTIVE })]);
  const edit = await call("PATCH", { id: "asset-1", assignedUserId: GONE });
  assert.equal(edit.status, 400);
  assert.match(edit.body.error, /active department member/);
  const create = await call("POST", { equipmentTypeId: "type-1", assignedUserId: GONE });
  assert.equal(create.status, 400);
  assert.match(create.body.error, /active department member/);
  const vehicle = await call("PATCH", { id: "asset-1", assignedUserId: "", assignedVehicleId: "vehicle-retired" });
  assert.equal(vehicle.status, 400);
});

test("EQP-12: taking equipment out of service or removing it requires a reason; returning to active clears it", async () => {
  const { call } = await load();
  const db = world([asset({ assigned_user_id: ACTIVE })]);
  const missing = await call("PATCH", { id: "asset-1", lifecycleStatus: "out_of_service" });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /reason is required/);
  assert.equal((await call("PATCH", { id: "asset-1", lifecycleStatus: "removed" })).status, 400);
  assert.equal((await call("PATCH", { id: "asset-1", lifecycleStatus: "out_of_service", removalReason: "Cracked housing" })).status, 200);
  // An unrelated edit while out of service keeps the reason.
  assert.equal((await call("PATCH", { id: "asset-1", notes: "Sent for repair" })).status, 200);
  assert.equal(db.tables.equipment_assets[0].removal_reason, "Cracked housing");
  assert.equal((await call("PATCH", { id: "asset-1", lifecycleStatus: "active" })).status, 200);
  assert.equal(db.tables.equipment_assets[0].removal_reason, null);
});

test("EQP-12: equipment dates are validated on create and edit", async () => {
  const { call } = await load();
  const db = world([asset({ assigned_user_id: ACTIVE })]);
  for (const body of [{ issueDate: "2026-02-30" }, { expirationDate: "next year" }, { nextInspectionDate: "10/20/2026" }, { lastInspectionDate: 20261020 }]) {
    const result = await call("PATCH", { id: "asset-1", ...body });
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.match(result.body.error, /must be a valid date/);
  }
  const reversed = await call("PATCH", { id: "asset-1", expirationDate: "2025-12-31" });
  assert.equal(reversed.status, 400);
  assert.match(reversed.body.error, /cannot be before the issue date/);
  assert.equal((await call("POST", { equipmentTypeId: "type-1", issueDate: "2026-13-01" })).status, 400);
  const updatesBefore = db.updates.length;
  assert.equal((await call("PATCH", { id: "asset-1", nextInspectionDate: "2027-02-28", lastInspectionDate: "" })).status, 200);
  assert.equal(db.updates.length, updatesBefore + 1);
  assert.equal(db.tables.equipment_assets[0].next_inspection_date, "2027-02-28");
  assert.equal(db.tables.equipment_assets[0].last_inspection_date, null);
  assert.equal((await call("POST", { equipmentTypeId: "type-1", issueDate: "2026-10-20", expirationDate: "2031-10-20" })).status, 201);
});

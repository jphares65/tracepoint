/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Handler-level tests for the fleet integrity fixes (FLT-01, FLT-02, FLT-08, FLT-09).
// The route handlers run unchanged against an in-memory data client; only the
// session resolver and the server-only marker are replaced (route modules load
// as CommonJS under tsx, so the stubs are placed in the require cache).
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__fleetIntegrityAccess,
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
});

type Row = Record<string, any>;
function createDb(tables: Record<string, Row[]>, fail: (table: string, op: string) => string | null = () => null) {
  function from(table: string) {
    tables[table] ??= [];
    const filters: ((row: Row) => boolean)[] = [];
    let op = "select"; let payload: any = null; let single: "one" | "maybe" | null = null; let returning = false; let columns = "*";
    const builder: any = {
      select(selection = "*") { returning = true; columns = selection; return builder; },
      eq(column: string, value: any) { filters.push((row) => String(row[column]) === String(value)); return builder; },
      neq(column: string, value: any) { filters.push((row) => row[column] !== value); return builder; },
      not(column: string, operator: string, value: any) { const values = String(value).replace(/[()"]/g, "").split(","); filters.push((row) => !values.includes(row[column])); void operator; return builder; },
      or() { return builder; },
      order() { return builder; },
      maybeSingle() { single = "maybe"; return builder; },
      single() { single = "one"; return builder; },
      insert(value: any) { op = "insert"; payload = value; return builder; },
      update(value: any) { op = "update"; payload = value; return builder; },
      delete() { op = "delete"; return builder; },
      then(resolve: any, reject: any) { return Promise.resolve(run()).then(resolve, reject); },
    };
    function run() {
      const failure = fail(table, op);
      if (failure) return { data: null, error: { message: failure } };
      const rows = tables[table];
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]).map((row: Row) => ({ id: `${table}-${rows.length + 1}`, ...row }));
        rows.push(...list);
        return { data: single ? list[0] : list, error: null };
      }
      const stored = rows.filter((row) => filters.every((filter) => filter(row)));
      if (op === "update") for (const row of stored) Object.assign(row, payload);
      if (op === "delete") for (const row of stored) rows.splice(rows.indexOf(row), 1);
      const matched = stored.map((row) => columns === "*" ? { ...row } : Object.fromEntries(columns.split(",").map((column) => [column, row[column]])));
      if (single === "one") return matched.length === 1 ? { data: matched[0], error: null } : { data: null, error: { message: "not one row" } };
      if (single === "maybe") return { data: matched[0] ?? null, error: null };
      return { data: op === "select" || returning ? matched : null, error: null };
    }
    return builder;
  }
  return { from, tables };
}

const V = "11111111-1111-4111-8111-111111111111";
const MANAGER = ["manage_fleet", "view_fleet", "perform_fleet_inspections", "manage_fleet_maintenance"];
const vehicle = (over: Row = {}) => ({ id: V, department_id: "dept-1", unit_number: "3101", status: "Available", status_override_active: false, current_mileage: 19200, current_hours: 100, open_issue_count: 0, inspection_due_date: "2026-10-01", ...over });
const criticalOrder = { id: "wo-critical", department_id: "dept-1", vehicle_id: V, priority: "Critical", status: "Open", affects_availability: true, record_type: "Inspection", title: "Brakes" };
const checklist = (critical?: string) => ["body", "tires", "lights", "controls", "fluids", "interior"].map((id) => id === critical ? { id, condition: "Critical", note: "Brakes fail" } : { id, condition: "Pass" });
const fleet = (vehicles: Row[], workOrders: Row[] = []) => ({ fleet_rules: [], fleet_vehicles: vehicles, fleet_work_orders: workOrders, fleet_vehicle_equipment: [], fleet_vehicle_inspections: [], audit_events: [] });
const params = (value: Row) => ({ params: Promise.resolve(value) as any });
const signIn = (db: any, permissions: string[]) => { (globalThis as any).__fleetIntegrityAccess = { ok: true, context: { admin: db, db, departmentId: "dept-1", user: { id: "user-1" }, permissions, roleCodes: [], isSuperAdmin: false, isSupportMode: false } }; };

async function load() {
  const { NextRequest } = await import("next/server");
  const json = (url: string, method: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return {
    json,
    server: await import("../tracepoint/fleet-server.ts"),
    inspections: await import("../../app/api/fleet/vehicles/[vehicleId]/inspections/route.ts"),
    workOrders: await import("../../app/api/fleet/vehicles/[vehicleId]/work-orders/route.ts"),
    vehicleRoute: await import("../../app/api/fleet/vehicles/[vehicleId]/route.ts"),
    listRoute: await import("../../app/api/fleet/vehicles/route.ts"),
  };
}

test("FLT-01 a manual override never leaves a vehicle with an open critical defect Available, and keeps a stricter manager status", async () => {
  const { server } = await load();
  for (const [status, expected] of [["Available", "Out of Service"], ["Attention", "Out of Service"], ["Maintenance", "Maintenance"], ["Out of Service", "Out of Service"], ["Retired", "Retired"]]) {
    const db = createDb(fleet([vehicle({ status, status_override_active: true })], [criticalOrder]));
    const readiness = await server.refreshFleetVehicle({ admin: db, departmentId: "dept-1" }, V);
    assert.equal(readiness.status, expected, `override ${status}`);
    assert.equal(db.tables.fleet_vehicles[0].status_override_active, true);
  }
  const db = createDb(fleet([vehicle({ status: "Out of Service", status_override_active: true })], [{ ...criticalOrder, priority: "Normal", affects_availability: false }]));
  assert.equal((await server.refreshFleetVehicle({ admin: db, departmentId: "dept-1" }, V)).status, "Out of Service", "automation never makes an overridden vehicle more available");
});

test("FLT-01 manager sets Available, then a Critical inspection defect takes the vehicle out of service", async () => {
  const { json, vehicleRoute, inspections } = await load();
  const db = createDb(fleet([vehicle({ status: "Maintenance" })]));
  signIn(db, MANAGER);
  assert.equal((await vehicleRoute.PATCH(json(`/api/fleet/vehicles/${V}`, "PATCH", { status: "Available", reason: "repaired" }), params({ vehicleId: V }))).status, 200);
  assert.equal(db.tables.fleet_vehicles[0].status_override_active, true);
  const response = await inspections.POST(json(`/api/mobile/fleet/vehicles/${V}/inspections`, "POST", { checklist: checklist("controls"), mileage: 19250 }), params({ vehicleId: V }));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.workOrder.priority, "Critical");
  assert.equal(body.readiness.status, "Out of Service");
  assert.equal(db.tables.fleet_vehicles[0].status, "Out of Service");
});

test("FLT-01 a manual Available through the fleet list does not mask an open critical work order", async () => {
  const { json, listRoute } = await load();
  const db = createDb(fleet([vehicle({ status: "Out of Service" })], [criticalOrder]));
  signIn(db, MANAGER);
  const response = await listRoute.PATCH(json("/api/fleet/vehicles", "PATCH", { id: V, status: "Available", reason: "manager override", openIssueCount: 0 }));
  assert.equal(response.status, 200);
  assert.equal(db.tables.fleet_vehicles[0].status, "Out of Service");
  assert.equal(db.tables.fleet_vehicles[0].open_issue_count, 1, "FLT-19: the open-issue count is recomputed");
  assert.equal((await listRoute.PATCH(json("/api/fleet/vehicles", "PATCH", { id: V, comments: "spare keys in office", reason: "note" }))).status, 200);
  assert.equal(db.tables.fleet_vehicles[0].status_override_active, true, "an edit that keeps the status leaves the override flag alone");
});

test("FLT-02 work-order edits never roll the odometer or hour meter back; the work order keeps its own reading", async () => {
  const { json, workOrders } = await load();
  const db = createDb(fleet([vehicle()], [{ id: "wo1", department_id: "dept-1", vehicle_id: V, record_type: "Repair", title: "Service", priority: "Normal", status: "Open", mileage: 18000, hours: 90 }]));
  signIn(db, ["manage_fleet_maintenance"]);
  const response = await workOrders.PATCH(json(`/api/fleet/vehicles/${V}/work-orders`, "PATCH", { id: "wo1", reason: "close", status: "Completed", mileage: 18000, hours: 90 }), params({ vehicleId: V }));
  assert.equal(response.status, 200);
  assert.equal(db.tables.fleet_vehicles[0].current_mileage, 19200);
  assert.equal(db.tables.fleet_vehicles[0].current_hours, 100);
  assert.equal(db.tables.fleet_work_orders[0].mileage, 18000);
  assert.equal(db.tables.fleet_vehicles[0].last_service_mileage, 18000);
  await workOrders.POST(json(`/api/fleet/vehicles/${V}/work-orders`, "POST", { recordType: "Issue", title: "Dent", mileage: 19400 }), params({ vehicleId: V }));
  assert.equal(db.tables.fleet_vehicles[0].current_mileage, 19400, "a higher reading still advances the odometer");
});

test("FLT-09 blank or null mileage means not provided", async () => {
  const { json, server, workOrders, inspections } = await load();
  const db = createDb(fleet([vehicle()]));
  signIn(db, []);
  assert.equal((await workOrders.POST(json(`/api/fleet/vehicles/${V}/work-orders`, "POST", { recordType: "Issue", title: "Dent", mileage: "", hours: null }), params({ vehicleId: V }))).status, 201);
  assert.equal(db.tables.fleet_vehicles[0].current_mileage, 19200);
  assert.equal(db.tables.fleet_vehicles[0].current_hours, 100);
  signIn(db, ["perform_fleet_inspections"]);
  const response = await inspections.POST(json(`/api/mobile/fleet/vehicles/${V}/inspections`, "POST", { checklist: checklist(), mileage: null, hours: "" }), params({ vehicleId: V }));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.inspection.mileage, 19200);
  assert.equal(body.inspection.hours, 100);
  assert.equal(db.tables.fleet_vehicles[0].current_mileage, 19200);
  assert.deepEqual(["", null, "  ", undefined, "x", "0", "19250.4"].map(server.optionalNumeric), [null, null, null, null, null, 0, 19250.4]);
});

test("FLT-08 a failed work-order insert or audit is reported and leaves no partial inspection", async () => {
  const { json, inspections } = await load();
  for (const [table, op, step] of [["fleet_work_orders", "insert", "creating the defect work order"], ["audit_events", "insert", "recording the audit entry"]]) {
    const db = createDb(fleet([vehicle({ status_override_active: false })]), (t, o) => t === table && o === op ? "permission denied" : null);
    signIn(db, ["perform_fleet_inspections"]);
    const response = await inspections.POST(json(`/api/mobile/fleet/vehicles/${V}/inspections`, "POST", { checklist: checklist("controls"), mileage: 19300 }), params({ vehicleId: V }));
    const body = await response.json();
    assert.equal(response.status, 500, table);
    assert.match(body.error, new RegExp(`not saved because ${step} failed \\((Audit record failed: )?permission denied\\)\\. No changes were kept`));
    assert.equal(body.ok, undefined);
    assert.equal(db.tables.fleet_vehicle_inspections.length, 0);
    assert.equal(db.tables.fleet_work_orders.length, 0);
    assert.deepEqual([db.tables.fleet_vehicles[0].status, db.tables.fleet_vehicles[0].current_mileage, db.tables.fleet_vehicles[0].inspection_due_date], ["Available", 19200, "2026-10-01"]);
  }
});

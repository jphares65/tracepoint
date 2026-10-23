/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Handler-level tests for the fleet integrity fixes (FLT-01, FLT-02, FLT-08, FLT-09),
// the inspection audit outbox, odometer corrections and the F3 critical safety hold.
// The route handlers run unchanged against an in-memory data client; only the
// session resolver and the server-only marker are replaced (route modules load
// as CommonJS under tsx, so the stubs are placed in the require cache).
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__fleetIntegrityAccess,
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  hasServerFeature: (context: any, code: string) => (context.enabledFeatures ?? []).includes(code),
  featureDisabledResponse: (name = "This TracePoint module") => Response.json({ error: `${name} is not enabled for this agency.`, code: "FEATURE_NOT_ENABLED" }, { status: 403 }),
  hasAnyServerPermission: (context: any, codes: string[]) => context.permissions.includes("administer_department") || codes.some((code) => context.permissions.includes(code)),
  permissionDeniedResponse: (error: string) => Response.json({ error }, { status: 403 }),
});

type Row = Record<string, any>;
// `outbox: true` models database/aws/043: an inspection insert queues its audit
// entry, and the two delivery functions write audit_events. Without it the rpc is
// missing, as in bridge (Supabase) mode.
function createDb(tables: Record<string, Row[]>, fail: (table: string, op: string) => string | null = () => null, options: { outbox?: boolean } = {}) {
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 20, 12, 0, clock++)).toISOString();
  function from(table: string) {
    tables[table] ??= [];
    const filters: ((row: Row) => boolean)[] = [];
    let op = "select"; let payload: any = null; let single: "one" | "maybe" | null = null; let returning = false; let columns = "*";
    let ordering: [string, boolean] | null = null; let maximum: number | null = null;
    const builder: any = {
      select(selection = "*") { returning = true; columns = selection; return builder; },
      eq(column: string, value: any) { filters.push((row) => String(row[column]) === String(value)); return builder; },
      neq(column: string, value: any) { filters.push((row) => row[column] !== value); return builder; },
      gte(column: string, value: any) { filters.push((row) => String(row[column]) >= String(value)); return builder; },
      gt(column: string, value: any) { filters.push((row) => Number(row[column]) > Number(value)); return builder; },
      lt(column: string, value: any) { filters.push((row) => String(row[column]) < String(value)); return builder; },
      is(column: string, value: any) { filters.push((row) => (row[column] ?? null) === value); return builder; },
      in(column: string, values: any[]) { filters.push((row) => values.includes(row[column])); return builder; },
      not(column: string, operator: string, value: any) { const values = String(value).replace(/[()"]/g, "").split(","); filters.push((row) => !values.includes(row[column])); void operator; return builder; },
      or() { return builder; },
      order(column: string, options: { ascending?: boolean } = {}) { ordering = [column, options.ascending !== false]; return builder; },
      limit(value: number) { maximum = value; return builder; },
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
        const list = (Array.isArray(payload) ? payload : [payload]).map((row: Row): Row => ({ id: `${table}-${rows.length + 1}`, created_at: stamp(), ...row }));
        rows.push(...list);
        if (options.outbox && table === "fleet_vehicle_inspections") for (const row of list) {
          (tables.fleet_audit_outbox ??= []).push({ id: `outbox-${row.id}`, department_id: row.department_id, inspection_id: row.id, actor_user_id: row.inspector_user_id, action: "fleet_vehicle_inspected", entity_type: "fleet_vehicle", entity_id: row.vehicle_id, details: { inspection: row }, delivered_at: null, audit_event_id: null, attempts: 0 });
        }
        return { data: single ? list[0] : list, error: null };
      }
      let stored = rows.filter((row) => filters.every((filter) => filter(row)));
      if (ordering) { const [column, ascending] = ordering; stored = [...stored].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1)); }
      if (maximum !== null) stored = stored.slice(0, maximum);
      if (op === "update") for (const row of stored) Object.assign(row, payload);
      if (op === "delete") for (const row of stored) rows.splice(rows.indexOf(row), 1);
      const matched = stored.map((row) => columns === "*" ? { ...row } : Object.fromEntries(columns.split(",").map((column) => [column, row[column]])));
      if (single === "one") return matched.length === 1 ? { data: matched[0], error: null } : { data: null, error: { message: "not one row" } };
      if (single === "maybe") return { data: matched[0] ?? null, error: null };
      return { data: op === "select" || returning ? matched : null, error: null };
    }
    return builder;
  }
  function deliver(row: Row, workOrderId: string | null) {
    if (row.delivered_at) return row.audit_event_id;
    row.attempts += 1;
    if (fail("audit_events", "insert")) { row.last_error = "audit write failed"; return null; }
    const event = { id: tables.audit_events.length + 1, department_id: row.department_id, actor_user_id: row.actor_user_id, action: row.action, entity_type: row.entity_type, entity_id: row.entity_id, details: { ...row.details, work_order_id: workOrderId } };
    tables.audit_events.push(event);
    Object.assign(row, { delivered_at: stamp(), audit_event_id: event.id, last_error: null });
    return event.id;
  }
  async function rpc(name: string, args: Row) {
    if (!options.outbox) return { data: null, error: { code: "PGRST202", message: "function not found" } };
    const outbox = tables.fleet_audit_outbox ??= [];
    if (name === "deliver_fleet_audit_outbox") {
      const row = outbox.find((entry) => entry.inspection_id === args.p_inspection_id);
      return row ? { data: deliver(row, args.p_details?.work_order_id ?? null), error: null } : { data: null, error: { code: "42501", message: "fleet audit entry unavailable" } };
    }
    if (name === "deliver_pending_fleet_audit") {
      const pending = outbox.filter((entry) => entry.department_id === args.p_department_id && !entry.delivered_at);
      const delivered = pending.filter((entry) => deliver(entry, null) !== null).length;
      return { data: { delivered, failed: pending.length - delivered }, error: null };
    }
    return { data: null, error: { code: "PGRST202", message: "function not found" } };
  }
  return { from, rpc, tables };
}

const V = "11111111-1111-4111-8111-111111111111";
const MANAGER = ["manage_fleet", "view_fleet", "perform_fleet_inspections", "manage_fleet_maintenance"];
const vehicle = (over: Row = {}) => ({ id: V, department_id: "dept-1", unit_number: "3101", status: "Available", status_override_active: false, current_mileage: 19200, current_hours: 100, open_issue_count: 0, inspection_due_date: "2026-10-01", ...over });
const criticalOrder = { id: "wo-critical", department_id: "dept-1", vehicle_id: V, priority: "Critical", status: "Open", affects_availability: true, record_type: "Inspection", title: "Brakes" };
const checklist = (critical?: string) => ["body", "tires", "lights", "controls", "fluids", "interior"].map((id) => id === critical ? { id, condition: "Critical", note: "Brakes fail" } : { id, condition: "Pass" });
const fleet = (vehicles: Row[], workOrders: Row[] = []) => ({ fleet_rules: [], fleet_vehicles: vehicles, fleet_work_orders: workOrders, fleet_vehicle_equipment: [], fleet_vehicle_inspections: [], audit_events: [] });
const params = (value: Row) => ({ params: Promise.resolve(value) as any });
const signIn = (db: any, permissions: string[]) => { (globalThis as any).__fleetIntegrityAccess = { ok: true, context: { admin: db, db, departmentId: "dept-1", user: { id: "user-1" }, permissions, roleCodes: [], isSuperAdmin: false, isSupportMode: false, enabledFeatures: ["fleet"] } }; };

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
    notifications: await import("../tracepoint/fleet-notifications.ts"),
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

test("D-14 a typed open-issue count is never stored: a new vehicle starts at 0 and an edit keeps the computed count", async () => {
  const { json, listRoute } = await load();
  const db = createDb(fleet([vehicle()], [criticalOrder]));
  signIn(db, MANAGER);
  const created = await listRoute.POST(json("/api/fleet/vehicles", "POST", { unitNumber: "3102", status: "Available", currentMileage: 10, openIssueCount: 5 }));
  assert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
  assert.equal(db.tables.fleet_vehicles.find((row: Row) => row.unit_number === "3102")!.open_issue_count, 0);
  db.tables.fleet_vehicles[0].open_issue_count = 1;
  const update: Row[] = [];
  const original = db.from.bind(db);
  (db as any).from = (table: string) => { const builder = original(table); const write = builder.update; builder.update = (value: Row) => { if (table === "fleet_vehicles") update.push(value); return write(value); }; return builder; };
  assert.equal((await listRoute.PATCH(json("/api/fleet/vehicles", "PATCH", { id: V, comments: "keys", reason: "note", openIssueCount: 9 }))).status, 200);
  assert.equal("open_issue_count" in update[0], false, "the form value is not written");
  assert.equal(db.tables.fleet_vehicles[0].open_issue_count, 1);
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
  signIn(db, ["view_fleet"]);
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

const asInspector = (db: any) => signIn(db, ["perform_fleet_inspections"]);
const inspect = async (inspections: any, json: any, list = checklist("controls")) => {
  const response = await inspections.POST(json(`/api/mobile/fleet/vehicles/${V}/inspections`, "POST", { checklist: list, mileage: 19300 }), params({ vehicleId: V }));
  return { status: response.status, body: await response.json() };
};

test("FLT-08 audit failure on a critical inspection keeps the inspection and the safety status and reports the entry as queued", async () => {
  const { json, inspections } = await load();
  let auditDown = true;
  const db = createDb(fleet([vehicle()]), (t, o) => auditDown && t === "audit_events" && o === "insert" ? "audit store unavailable" : null, { outbox: true });
  asInspector(db);
  const { status, body } = await inspect(inspections, json);
  assert.equal(status, 201);
  assert.equal(body.ok, true);
  assert.equal(body.audit.status, "pending");
  assert.match(body.audit.message, /audit entry could not be recorded yet\. It is queued/);
  assert.equal(db.tables.fleet_vehicle_inspections.length, 1, "inspection kept");
  assert.equal(db.tables.fleet_work_orders.length, 1, "defect work order kept");
  assert.equal(db.tables.fleet_vehicles[0].status, "Out of Service");
  assert.equal(db.tables.fleet_vehicles[0].current_mileage, 19300, "nothing reversed");
  assert.equal(db.tables.audit_events.length, 0);
  assert.deepEqual(db.tables.fleet_audit_outbox.map((row: Row) => [row.delivered_at, row.attempts]), [[null, 1]]);

  // Recovery: the next inspection POST reconciles the queued entry first.
  auditDown = false;
  const next = await inspect(inspections, json, checklist());
  assert.equal(next.status, 201);
  assert.equal(next.body.audit.status, "recorded");
  assert.equal(db.tables.audit_events.length, 2);
  assert.deepEqual(db.tables.audit_events.map((event: Row) => event.details.inspection.id), db.tables.fleet_vehicle_inspections.map((row: Row) => row.id));
  assert.ok(db.tables.fleet_audit_outbox.every((row: Row) => row.delivered_at));
  assert.equal(db.tables.fleet_vehicles[0].status, "Out of Service", "the open critical defect still holds the vehicle");
});

test("FLT-08 without the outbox (bridge mode) an audit failure is reported as unrecorded, never as audited, and nothing is reversed", async () => {
  const { json, inspections } = await load();
  const db = createDb(fleet([vehicle()]), (t, o) => t === "audit_events" && o === "insert" ? "permission denied" : null);
  asInspector(db);
  const { status, body } = await inspect(inspections, json);
  assert.equal(status, 201);
  assert.equal(body.audit.status, "unrecorded");
  assert.match(body.audit.message, /could not be recorded or queued/);
  assert.equal(db.tables.fleet_vehicle_inspections.length, 1);
  assert.equal(db.tables.fleet_vehicles[0].status, "Out of Service");
});

test("FLT-08 successful inspection records its audit entry exactly once", async () => {
  const { json, server, inspections } = await load();
  const db = createDb(fleet([vehicle()]), undefined, { outbox: true });
  asInspector(db);
  const { status, body } = await inspect(inspections, json);
  assert.equal(status, 201);
  assert.deepEqual(body.audit, { status: "recorded" });
  assert.equal(db.tables.audit_events.length, 1);
  assert.equal(db.tables.audit_events[0].details.work_order_id, body.workOrder.id);
  assert.deepEqual(await server.recordInspectionAudit({ admin: db, departmentId: "dept-1" }, body.inspection, body.workOrder.id), { status: "recorded" });
  assert.equal(db.tables.audit_events.length, 1, "a repeated delivery does not duplicate the entry");
  const bridge = createDb(fleet([vehicle()]));
  asInspector(bridge);
  assert.deepEqual((await inspect(inspections, json)).body.audit, { status: "recorded" });
  assert.equal(bridge.tables.audit_events.length, 1);
});

test("FLT-08 a failed defect work order never returns a critical vehicle to service; the inspection is kept", async () => {
  const { json, server, inspections } = await load();
  const db = createDb(fleet([vehicle({ status_override_active: true })]), (t, o) => t === "fleet_work_orders" && o === "insert" ? "permission denied" : null, { outbox: true });
  asInspector(db);
  const { status, body } = await inspect(inspections, json);
  assert.equal(status, 500);
  assert.equal(body.ok, false);
  assert.match(body.error, /inspection and its critical defect were saved, but creating the defect work order failed \(permission denied\)\. The vehicle is Out of Service\. Do not submit the inspection again/);
  assert.equal(body.vehicleOutOfService, true);
  assert.equal(body.audit.status, "recorded");
  assert.equal(db.tables.fleet_vehicle_inspections.length, 1);
  assert.equal(db.tables.fleet_vehicles[0].status, "Out of Service");
  assert.match(db.tables.fleet_vehicles[0].status_reason, /creating the defect work order did not complete/);
  // A later readiness refresh (no work order exists) still treats the critical inspection as unresolved.
  assert.equal((await server.refreshFleetVehicle({ admin: db, departmentId: "dept-1" }, V)).status, "Out of Service");
  db.tables.fleet_vehicles[0].status_override_active = false;
  assert.equal((await server.refreshFleetVehicle({ admin: db, departmentId: "dept-1" }, V)).status, "Out of Service");
});

test("FLT-08 a non-critical inspection whose work order fails is still reversed and reported as not saved", async () => {
  const { json, inspections } = await load();
  const db = createDb(fleet([vehicle()]), (t, o) => t === "fleet_work_orders" && o === "insert" ? "permission denied" : null, { outbox: true });
  asInspector(db);
  const defect = checklist().map((item) => item.id === "body" ? { id: "body", condition: "Defect", note: "cracked mirror" } : item);
  const { status, body } = await inspect(inspections, json, defect);
  assert.equal(status, 500);
  assert.match(body.error, /not saved because creating the defect work order failed \(permission denied\)\. No changes were kept/);
  assert.equal(db.tables.fleet_vehicle_inspections.length, 0);
  assert.deepEqual([db.tables.fleet_vehicles[0].status, db.tables.fleet_vehicles[0].current_mileage], ["Available", 19200]);

  // On AWS the subject may not delete inspections: the kept record is reported and its audit entry delivered.
  const kept = createDb(fleet([vehicle()]), (t, o) => (t === "fleet_work_orders" && o === "insert") || (t === "fleet_vehicle_inspections" && o === "delete") ? "permission denied" : null, { outbox: true });
  asInspector(kept);
  const second = await inspect(inspections, json, defect);
  assert.equal(second.status, 500);
  assert.match(second.body.error, /could not be completed because creating the defect work order failed \(permission denied\)\. Some changes could not be reversed and the inspection record was kept\. Do not submit it again/);
  assert.equal(second.body.audit.status, "recorded");
  assert.equal(kept.tables.fleet_vehicle_inspections.length, 1);
  assert.equal(kept.tables.audit_events.length, 1);
});

test("Odometer corrections: lowering needs a correction reason and is audited; increases are unchanged", async () => {
  const { json, vehicleRoute, listRoute } = await load();
  const db = createDb(fleet([vehicle()]));
  signIn(db, MANAGER);
  const patch = (body: Row) => vehicleRoute.PATCH(json(`/api/fleet/vehicles/${V}`, "PATCH", body), params({ vehicleId: V }));
  let response = await patch({ currentMileage: 1920, reason: "typo" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /correction/);
  assert.equal(db.tables.fleet_vehicles[0].current_mileage, 19200);
  assert.equal((await patch({ currentMileage: -5, reason: "x", mileageCorrectionReason: "x" })).status, 400);
  assert.equal((await patch({ currentMileage: 1920.5, reason: "x", mileageCorrectionReason: "x" })).status, 400);
  assert.equal(db.tables.audit_events.length, 0);
  response = await patch({ currentMileage: 1920, reason: "fix reading", mileageCorrectionReason: "extra zero typed at intake" });
  assert.equal(response.status, 200);
  assert.equal(db.tables.fleet_vehicles[0].current_mileage, 1920);
  assert.equal(db.tables.audit_events.length, 1);
  assert.equal(db.tables.audit_events[0].action, "fleet_odometer_corrected");
  assert.deepEqual(db.tables.audit_events[0].details.mileage_correction, { reason: "extra zero typed at intake", previous_mileage: 19200, new_mileage: 1920, previous_hours: 100, new_hours: 100 });
  assert.equal((await patch({ currentMileage: 2000, reason: "new reading" })).status, 200);
  assert.equal(db.tables.audit_events[1].action, "fleet_vehicle_updated");

  const list = (body: Row) => listRoute.PATCH(json("/api/fleet/vehicles", "PATCH", { id: V, ...body }));
  assert.equal((await list({ currentMileage: "1500", reason: "typo" })).status, 400);
  assert.equal(db.tables.fleet_vehicles[0].current_mileage, 2000);
  assert.equal((await list({ currentHours: "50", reason: "meter", mileageCorrectionReason: "meter replaced" })).status, 200);
  assert.equal(db.tables.fleet_vehicles[0].current_hours, 50);
  const corrected = db.tables.audit_events.at(-1) as Row;
  assert.equal(corrected.action, "fleet_odometer_corrected");
  assert.equal(corrected.details.mileage_correction.previous_hours, 100);
  assert.equal((await list({ currentMileage: "2100", reason: "new reading" })).status, 200);
  assert.equal((db.tables.audit_events.at(-1) as Row).action, "fleet_vehicle_updated");
});

// F3: a critical safety hold is released by a later inspection without critical defects or by an
// audited fleet-manager clearance, never by closing or cancelling the critical work order.
const heldOrder = (over: Row = {}) => ({ ...criticalOrder, created_at: "2026-10-01T08:00:00.000Z", ...over });

test("F3 completing or cancelling the critical work order keeps the safety hold until a passing inspection", async () => {
  const { json, workOrders, inspections } = await load();
  for (const status of ["Completed", "Cancelled"]) {
    const db = createDb(fleet([vehicle({ status: "Out of Service" })], [heldOrder()]));
    db.tables.fleet_vehicle_inspections.push({ id: "insp-critical", department_id: "dept-1", vehicle_id: V, critical_defect_count: 1, created_at: "2026-10-01T07:59:00.000Z" });
    signIn(db, ["manage_fleet_maintenance"]);
    const response = await workOrders.PATCH(json(`/api/fleet/vehicles/${V}/work-orders`, "PATCH", { id: "wo-critical", reason: "repaired", status }), params({ vehicleId: V }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.readiness.status, "Out of Service", `${status} alone does not release`);
    assert.match(body.readiness.safetyHold.reason, /Critical work order "Brakes" recorded on 2026-10-01\. .*later inspection records no critical defects or a fleet manager clears the hold/);
    assert.equal(db.tables.fleet_vehicles[0].status, "Out of Service");
    asInspector(db);
    const passed = await inspect(inspections, json, checklist());
    assert.equal(passed.status, 201);
    assert.equal(passed.body.readiness.status, "Available", "a later inspection without critical defects releases the hold");
    assert.equal(passed.body.readiness.safetyHold, null);
  }
});

test("F3 a fleet manager clears a safety hold only with a reason; the clearance is audited and readiness recalculated", async () => {
  const { json, vehicleRoute } = await load();
  const db = createDb(fleet([vehicle({ status: "Out of Service" })], [heldOrder({ status: "Completed" })]));
  const clear = (body: Row) => vehicleRoute.PATCH(json(`/api/fleet/vehicles/${V}`, "PATCH", body), params({ vehicleId: V }));
  for (const permissions of [["manage_fleet_maintenance"], ["perform_fleet_inspections"], ["manage_fleet_rules"]]) {
    signIn(db, permissions);
    assert.equal((await clear({ clearSafetyHold: true, clearanceReason: "looks fine" })).status, 403, `${permissions} cannot clear`);
  }
  signIn(db, MANAGER);
  for (const clearanceReason of [undefined, "", "   "]) {
    const response = await clear({ clearSafetyHold: true, clearanceReason, reason: "general reason is not a clearance reason" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /reason for clearing the safety hold/);
  }
  assert.equal(db.tables.fleet_vehicles[0].safety_hold_cleared_at, undefined);
  assert.equal(db.tables.audit_events.length, 0);

  // An audit failure reverses the clearance.
  const down = createDb(fleet([vehicle({ status: "Out of Service" })], [heldOrder({ status: "Completed" })]), (t, o) => t === "audit_events" && o === "insert" ? "audit store unavailable" : null);
  signIn(down, MANAGER);
  const failed = await clear({ clearSafetyHold: true, clearanceReason: "brakes replaced and road tested" });
  assert.equal(failed.status, 500);
  assert.match((await failed.json()).error, /safety hold was not cleared/);
  assert.equal(down.tables.fleet_vehicles[0].safety_hold_cleared_at, null);
  assert.equal(down.tables.fleet_vehicles[0].status, "Out of Service");

  signIn(db, MANAGER);
  const response = await clear({ clearSafetyHold: true, clearanceReason: "brakes replaced and road tested" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.readiness.status, "Available");
  assert.equal(db.tables.fleet_vehicles[0].status, "Available");
  assert.equal(db.tables.fleet_vehicles[0].status_override_active, false, "the clearance sets no manual status");
  assert.deepEqual([db.tables.fleet_vehicles[0].safety_hold_cleared_by, db.tables.fleet_vehicles[0].safety_hold_clearance_reason], ["user-1", "brakes replaced and road tested"]);
  assert.equal(db.tables.audit_events.length, 1);
  assert.equal(db.tables.audit_events[0].action, "fleet_safety_hold_cleared");
  assert.equal(db.tables.audit_events[0].actor_user_id, "user-1");
  assert.equal(db.tables.audit_events[0].details.reason, "brakes replaced and road tested");
  assert.equal(db.tables.audit_events[0].details.hold.since, "2026-10-01T08:00:00.000Z");
  assert.equal((await clear({ clearSafetyHold: true, clearanceReason: "again" })).status, 409, "nothing left to clear");
});

// AT-1 (staging acceptance 2026-10-22): a manual Available or Attention on a held vehicle was answered 200 while
// the database guard kept the status, and the override flag and reason it saved kept the vehicle Out of Service
// after the hold was released. Both manual-status routes now refuse first and write nothing.
const heldVehicle = () => createDb(fleet([vehicle({ status: "Out of Service", status_override_active: false, status_reason: "Held" })], [heldOrder({ status: "Completed" })]));

test("AT-1 a held vehicle cannot be set Available or Attention, and the refusal writes nothing", async () => {
  const { json, vehicleRoute, listRoute } = await load();
  for (const status of ["Available", "Attention"]) {
    for (const [route, send] of [
      ["vehicle", (body: Row) => vehicleRoute.PATCH(json(`/api/fleet/vehicles/${V}`, "PATCH", body), params({ vehicleId: V }))],
      ["list", (body: Row) => listRoute.PATCH(json("/api/fleet/vehicles", "PATCH", { id: V, ...body }))],
    ] as const) {
      const db = heldVehicle();
      signIn(db, MANAGER);
      const response = await send({ status, reason: "manager says it is fine" });
      const body = await response.json();
      assert.equal(response.status, 409, `${route} ${status}`);
      assert.match(body.error, /under a safety hold and was not changed\. Critical work order "Brakes" recorded on 2026-10-01/);
      assert.equal(body.safetyHold.source, "work_order");
      const row = db.tables.fleet_vehicles[0];
      assert.deepEqual([row.status, row.status_override_active, row.status_reason], ["Out of Service", false, "Held"], `${route} ${status} wrote nothing`);
      assert.equal(db.tables.audit_events.length, 0, `${route} ${status} recorded no update`);
    }
  }
});

test("AT-1 a stricter manual status stays allowed under a hold, and Available is allowed once the hold is cleared", async () => {
  const { json, vehicleRoute, listRoute } = await load();
  const db = heldVehicle();
  signIn(db, MANAGER);
  assert.equal((await vehicleRoute.PATCH(json(`/api/fleet/vehicles/${V}`, "PATCH", { status: "Maintenance", reason: "in the shop" }), params({ vehicleId: V }))).status, 200);
  assert.equal(db.tables.fleet_vehicles[0].status, "Maintenance");
  assert.equal((await listRoute.PATCH(json("/api/fleet/vehicles", "PATCH", { id: V, comments: "keys at the desk", reason: "note" }))).status, 200, "edits that keep the status are not checked");

  const cleared = heldVehicle();
  cleared.tables.fleet_vehicles[0].safety_hold_cleared_at = "2026-10-02T09:00:00.000Z";
  signIn(cleared, MANAGER);
  const response = await vehicleRoute.PATCH(json(`/api/fleet/vehicles/${V}`, "PATCH", { status: "Available", reason: "returned to service" }), params({ vehicleId: V }));
  assert.equal(response.status, 200);
  assert.equal(cleared.tables.fleet_vehicles[0].status_override_active, true, "a manager status after clearance is a normal override");
});

test("AT-1 a hold the check did not see is rolled back when the guard keeps the status", async () => {
  const { json, vehicleRoute, listRoute } = await load();
  // Stand-in for database/aws/057: the guard keeps Out of Service whatever status is written.
  const guarded = (db: ReturnType<typeof createDb>) => {
    const from = db.from;
    db.from = (table: string) => {
      const builder = from(table);
      if (table !== "fleet_vehicles") return builder;
      const update = builder.update;
      builder.update = (value: Row) => update(value.status === "Available" || value.status === "Attention" ? { ...value, status: "Out of Service" } : value);
      return builder;
    };
    return db;
  };
  for (const [route, send] of [
    ["vehicle", (body: Row) => vehicleRoute.PATCH(json(`/api/fleet/vehicles/${V}`, "PATCH", body), params({ vehicleId: V }))],
    ["list", (body: Row) => listRoute.PATCH(json("/api/fleet/vehicles", "PATCH", { id: V, ...body }))],
  ] as const) {
    const db = guarded(createDb(fleet([vehicle({ status: "Out of Service", status_override_active: false, status_reason: "Held" })])));
    signIn(db, MANAGER);
    const response = await send({ status: "Available", reason: "race with a new critical defect" });
    assert.equal(response.status, 409, route);
    assert.match((await response.json()).error, /safety hold kept this vehicle out of service, so the update was not saved/);
    const row = db.tables.fleet_vehicles[0];
    assert.deepEqual([row.status, row.status_override_active, row.status_reason], ["Out of Service", false, "Held"], `${route} rolled back the override and reason`);
    assert.equal(db.tables.audit_events.length, 0, `${route} recorded no update`);
  }
});

test("F6a a safety hold cannot be cleared while a critical work order is open; once it is closed the clearance is allowed", async () => {
  const { json, vehicleRoute, workOrders } = await load();
  const db = createDb(fleet([vehicle({ status: "Out of Service" })], [heldOrder()]));
  signIn(db, MANAGER);
  const clear = () => vehicleRoute.PATCH(json(`/api/fleet/vehicles/${V}`, "PATCH", { clearSafetyHold: true, clearanceReason: "manager reviewed" }), params({ vehicleId: V }));
  const blocked = await clear();
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /cannot be cleared while a critical work order is open \("Brakes"\)\. Complete or cancel it first/);
  assert.equal(db.tables.fleet_vehicles[0].safety_hold_cleared_at, undefined, "nothing is written");
  assert.equal(db.tables.audit_events.length, 0, "nothing is audited");
  const affecting = createDb(fleet([vehicle({ status: "Out of Service" })], [heldOrder({ priority: "High", status: "In Progress" })]));
  signIn(affecting, MANAGER);
  assert.equal((await vehicleRoute.PATCH(json(`/api/fleet/vehicles/${V}`, "PATCH", { clearSafetyHold: true, clearanceReason: "x" }), params({ vehicleId: V }))).status, 409, "an open availability-affecting work order also blocks");

  signIn(db, ["manage_fleet_maintenance"]);
  const completed = await workOrders.PATCH(json(`/api/fleet/vehicles/${V}/work-orders`, "PATCH", { id: "wo-critical", reason: "repaired", status: "Completed" }), params({ vehicleId: V }));
  assert.equal((await completed.json()).readiness.status, "Out of Service", "closing the work order alone does not release the hold");
  signIn(db, MANAGER);
  const response = await clear();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.readiness.status, "Available");
  assert.equal(body.readiness.safetyHold, null);
  assert.equal(db.tables.audit_events.at(-1)?.action, "fleet_safety_hold_cleared");
  assert.equal(db.tables.audit_events.at(-1)?.details.reason, "manager reviewed");
});

test("F6a critical safety holds apply whatever the agency's automation settings; other automation still follows them", async () => {
  const { json, server, vehicleRoute } = await load();
  const ctx = (db: any) => ({ admin: db, departmentId: "dept-1" });
  const off = [{ department_id: "dept-1", status_automation_enabled: false, critical_issue_out_of_service: false }];
  for (const rules of [off, [{ department_id: "dept-1", status_automation_enabled: true, critical_issue_out_of_service: false }]]) {
    const label = JSON.stringify(rules[0]);
    // A recorded hold (the critical work order is completed) and an open critical work order.
    for (const order of [heldOrder({ status: "Completed" }), heldOrder()]) {
      const db = createDb({ ...fleet([vehicle({ status: "Available" })], [order]), fleet_rules: rules });
      const readiness = await server.refreshFleetVehicle(ctx(db), V);
      assert.equal(readiness.status, "Out of Service", `${label} ${order.status}`);
      assert.equal(db.tables.fleet_vehicles[0].status, "Out of Service");
      assert.match(String(readiness.safetyHold?.reason), /Critical work order "Brakes" recorded on 2026-10-01/, `${label} ${order.status}`);
    }
    const inspected = createDb({ ...fleet([vehicle({ status: "Attention" })]), fleet_rules: rules });
    inspected.tables.fleet_vehicle_inspections.push({ id: "insp-critical", department_id: "dept-1", vehicle_id: V, critical_defect_count: 1, created_at: "2026-10-02T08:00:00.000Z" });
    assert.equal((await server.refreshFleetVehicle(ctx(inspected), V)).safetyHold?.source, "inspection", label);
    assert.equal(inspected.tables.fleet_vehicles[0].status, "Out of Service", label);
    signIn(inspected, MANAGER);
    const detail = await (await vehicleRoute.GET(json(`/api/fleet/vehicles/${V}`, "GET", undefined), params({ vehicleId: V }))).json();
    assert.equal(detail.safetyHold?.source, "inspection", `${label}: the detail page shows the hold`);
  }
  // With automation off, non-critical automation stays off, and a stricter manual status is kept.
  for (const [status, expected] of [["Available", "Available"], ["Maintenance", "Maintenance"]]) {
    const db = createDb({ ...fleet([vehicle({ status })], [heldOrder({ priority: "High", affects_availability: false, status: "In Progress" })]), fleet_rules: off });
    assert.equal((await server.refreshFleetVehicle(ctx(db), V)).status, expected, `non-critical work, ${status}`);
  }
  const maintenance = createDb({ ...fleet([vehicle({ status: "Maintenance" })], [heldOrder()]), fleet_rules: off });
  assert.equal((await server.refreshFleetVehicle(ctx(maintenance), V)).status, "Maintenance", "a manager-set Maintenance is kept");
  // A passing inspection still releases a recorded hold with automation off; the vehicle's status is then the manager's to set.
  const released = createDb({ ...fleet([vehicle({ status: "Out of Service" })], [heldOrder({ status: "Completed" })]), fleet_rules: off });
  released.tables.fleet_vehicle_inspections.push({ id: "insp-pass", department_id: "dept-1", vehicle_id: V, critical_defect_count: 0, created_at: "2026-10-03T08:00:00.000Z" });
  const readiness = await server.refreshFleetVehicle(ctx(released), V);
  assert.deepEqual([readiness.status, readiness.safetyHold], ["Out of Service", null]);
});

test("F3 inspection audit entries pending for more than 24 hours alert fleet managers only", async () => {
  const { notifications } = await load();
  const ago = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
  const db = createDb({ ...fleet([vehicle()]), fleet_audit_outbox: [
    { id: "o1", department_id: "dept-1", created_at: ago(50), delivered_at: null, attempts: 4, last_error: "new row violates check constraint" },
    { id: "o2", department_id: "dept-1", created_at: ago(30), delivered_at: null, attempts: 0, last_error: null },
    { id: "o3", department_id: "dept-1", created_at: ago(2), delivered_at: null, attempts: 1, last_error: "timeout" },
    { id: "o4", department_id: "dept-1", created_at: ago(90), delivered_at: ago(80), attempts: 2, last_error: null },
    { id: "o5", department_id: "dept-2", created_at: ago(90), delivered_at: null, attempts: 0, last_error: null },
  ] });
  const alerts = async (permissions: string[]) => (await notifications.collectFleetNotifications({ admin: db, departmentId: "dept-1", user: { id: "user-1" }, permissions, roleCodes: [], isSuperAdmin: false })).filter((alert: Row) => alert.kind === "fleet_audit_pending");
  for (const permissions of [["manage_fleet"], ["administer_department"]]) {
    const [alert, ...rest] = await alerts(permissions);
    assert.equal(rest.length, 0);
    assert.equal(alert.title, "2 inspection audit entries not recorded");
    assert.match(alert.detail, /more than 24 hours; the oldest since \d{4}-\d{2}-\d{2} \(2 days\)\. Delivery is failing: new row violates check constraint\./);
    assert.equal(alert.source, "Fleet");
    assert.equal(alert.priority, "High");
  }
  for (const permissions of [["manage_fleet_maintenance"], ["manage_fleet_rules"], ["perform_fleet_inspections"], []]) assert.deepEqual(await alerts(permissions), [], `${permissions} sees no audit queue alert`);
});

// UX-RB2-1 (contract row C33): the server never turns an unanswered checklist
// item into an answer. Before, a missing or unknown condition was saved as Pass
// (or Defect/Critical from the equipment record) and could leave the vehicle
// Available after a zero-touch submission.
test("UX-RB2-1 an item without Pass, Defect or Critical is refused; nothing is saved and the vehicle is unchanged", async () => {
  const { json, inspections } = await load();
  for (const unanswered of [{ id: "tires" }, { id: "tires", condition: "" }, { id: "tires", condition: "pass" }, { id: "tires", condition: null }, { id: "tires", condition: "Not Inspected" }]) {
    const db = createDb(fleet([vehicle({ status: "Maintenance" })]));
    asInspector(db);
    const list = checklist().map((item) => (item.id === "tires" ? unanswered : item));
    const { status, body } = await inspect(inspections, json, list as any);
    assert.equal(status, 400, JSON.stringify(unanswered));
    assert.equal(body.code, "inspection_items_not_answered");
    assert.deepEqual(body.items, [{ id: "tires", label: "Tires and wheels" }]);
    assert.match(body.error, /Choose Pass, Defect or Critical for: Tires and wheels/);
    assert.equal(db.tables.fleet_vehicle_inspections.length, 0);
    assert.equal(db.tables.fleet_work_orders.length, 0);
    assert.equal(db.tables.fleet_vehicles[0].status, "Maintenance");
  }
});

test("UX-RB2-1 required equipment needs an explicit answer too; its record's status is not substituted", async () => {
  const { json, inspections } = await load();
  const db = createDb({ ...fleet([vehicle()]), fleet_vehicle_equipment: [{ id: "eq1", department_id: "dept-1", vehicle_id: V, category: "Medical", name: "AED", serial_number: null, status: "In Service", is_required: true, is_critical: true }] });
  asInspector(db);
  const omitted = await inspect(inspections, json, [...checklist(), { id: "equipment:eq1" }] as any);
  assert.equal(omitted.status, 400);
  assert.deepEqual(omitted.body.items, [{ id: "equipment:eq1", label: "Medical: AED" }]);
  assert.equal(db.tables.fleet_vehicle_inspections.length, 0);
  const answered = await inspect(inspections, json, [...checklist(), { id: "equipment:eq1", condition: "Pass" }]);
  assert.equal(answered.status, 201);
  assert.equal(answered.body.inspection.result, "Passed");
  assert.equal(db.tables.fleet_vehicle_inspections[0].checklist.find((item: any) => item.id === "equipment:eq1").condition, "Pass");
});

test("UX-RB2-1 explicit answers keep their meaning: a Defect on a critical item is still Critical", async () => {
  const { json, inspections } = await load();
  const db = createDb({ ...fleet([vehicle()]), fleet_vehicle_equipment: [{ id: "eq1", department_id: "dept-1", vehicle_id: V, category: "Medical", name: "AED", serial_number: null, status: "Missing", is_required: true, is_critical: true }] });
  asInspector(db);
  const { status, body } = await inspect(inspections, json, [...checklist(), { id: "equipment:eq1", condition: "Defect", note: "missing pads" }]);
  assert.equal(status, 201);
  assert.equal(body.inspection.result, "Failed");
  assert.equal(body.inspection.critical_defect_count, 1);
});

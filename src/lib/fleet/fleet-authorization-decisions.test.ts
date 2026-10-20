/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// F2 owner decisions: one inspection and issue-report eligibility rule
// (mirrors public.can_submit_fleet_inspection, database/aws/045), and no
// maintenance cost information for callers without fleet cost access.
// The route handlers run unchanged against an in-memory data client; only the
// session resolver and the server-only marker are replaced.
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__fleetDecisionAccess,
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  hasAnyServerPermission: (context: any, codes: string[]) => context.permissions.includes("administer_department") || codes.some((code) => context.permissions.includes(code)),
  permissionDeniedResponse: (error: string) => Response.json({ error }, { status: 403 }),
});

type Row = Record<string, any>;
function createDb(tables: Record<string, Row[]>) {
  const selections: Array<[string, string]> = [];
  function from(table: string) {
    tables[table] ??= [];
    const filters: ((row: Row) => boolean)[] = [];
    let op = "select"; let payload: any = null; let single: "one" | "maybe" | null = null; let returning = false; let columns = "*";
    const builder: any = {
      select(selection = "*") { returning = true; columns = selection; selections.push([table, selection]); return builder; },
      eq(column: string, value: any) { filters.push((row) => String(row[column]) === String(value)); return builder; },
      neq(column: string, value: any) { filters.push((row) => row[column] !== value); return builder; },
      gte(column: string, value: any) { filters.push((row) => String(row[column]) >= String(value)); return builder; },
      in(column: string, values: any[]) { filters.push((row) => values.includes(row[column])); return builder; },
      is(column: string, value: any) { filters.push((row) => (row[column] ?? null) === value); return builder; },
      not(column: string, operator: string, value: any) { const values = String(value).replace(/[()"]/g, "").split(","); filters.push((row) => !values.includes(row[column])); void operator; return builder; },
      or() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() { single = "maybe"; return builder; },
      single() { single = "one"; return builder; },
      insert(value: any) { op = "insert"; payload = value; return builder; },
      update(value: any) { op = "update"; payload = value; return builder; },
      delete() { op = "delete"; return builder; },
      then(resolve: any, reject: any) { return Promise.resolve(run()).then(resolve, reject); },
    };
    const project = (row: Row) => columns === "*" ? { ...row } : Object.fromEntries(columns.split(",").map((column) => [column, row[column]]));
    function run() {
      const rows = tables[table];
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]).map((row: Row): Row => ({ id: `${table}-${rows.length + 1}`, labor_cost: null, parts_cost: null, total_cost: null, created_at: new Date().toISOString(), ...row }));
        rows.push(...list);
        return { data: single ? project(list[0]) : list.map(project), error: null };
      }
      const stored = rows.filter((row) => filters.every((filter) => filter(row)));
      if (op === "update") for (const row of stored) Object.assign(row, payload);
      if (op === "delete") for (const row of stored) rows.splice(rows.indexOf(row), 1);
      const matched = stored.map(project);
      if (single === "one") return matched.length === 1 ? { data: matched[0], error: null } : { data: null, error: { message: "not one row" } };
      if (single === "maybe") return { data: matched[0] ?? null, error: null };
      return { data: op === "select" || returning ? matched : null, error: null };
    }
    return builder;
  }
  const rpc = async () => ({ data: null, error: { code: "PGRST202", message: "function not found" } });
  return { from, rpc, tables, selections };
}

const V = "22222222-2222-4222-8222-222222222222";
const COSTS = ["labor_cost", "parts_cost", "total_cost"];
const repair = { id: "wo-repair", department_id: "dept-1", vehicle_id: V, record_type: "Repair", title: "Brake pads", priority: "Normal", status: "Completed", affects_availability: false, vendor: "Main St Garage", labor_cost: 120, parts_cost: 80, total_cost: 200 };
const history = { id: "event-1", department_id: "dept-1", entity_type: "fleet_vehicle", entity_id: V, action: "fleet_work_order_updated", actor_user_id: null, details: { reason: "done", previous: { ...repair, total_cost: 150 }, current: repair } };
const fleet = (inspectionRoles: string[] = []) => ({
  fleet_rules: [{ department_id: "dept-1", inspection_role_codes: inspectionRoles }],
  fleet_vehicles: [{ id: V, department_id: "dept-1", unit_number: "3101", status: "Available", status_override_active: false, current_mileage: 19200, current_hours: 100, open_issue_count: 0 }],
  fleet_work_orders: [{ ...repair }], fleet_vehicle_equipment: [], fleet_vehicle_documents: [], fleet_vehicle_inspections: [],
  audit_events: [{ ...history }], attachments: [], profiles: [],
});
const params = (value: Row) => ({ params: Promise.resolve(value) as any });
const signIn = (db: any, permissions: string[], roleCodes: string[] = []) => { (globalThis as any).__fleetDecisionAccess = { ok: true, context: { admin: db, db, departmentId: "dept-1", user: { id: "user-1" }, permissions, roleCodes, isSuperAdmin: false, isSupportMode: false } }; };
const checklist = (critical?: string) => ["body", "tires", "lights", "controls", "fluids", "interior"].map((id) => id === critical ? { id, condition: "Critical", note: "Brakes fail" } : { id, condition: "Pass" });
const noCosts = (row: Row, label: string) => { for (const field of COSTS) assert.equal(field in row, false, `${label} carries ${field}`); };

async function load() {
  const { NextRequest } = await import("next/server");
  const request = (url: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost${url}`, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return {
    request,
    server: await import("../tracepoint/fleet-server.ts"),
    inspections: await import("../../app/api/fleet/vehicles/[vehicleId]/inspections/route.ts"),
    workOrders: await import("../../app/api/fleet/vehicles/[vehicleId]/work-orders/route.ts"),
    vehicleRoute: await import("../../app/api/fleet/vehicles/[vehicleId]/route.ts"),
    mobileVehicleRoute: await import("../../app/api/mobile/fleet/vehicles/[vehicleId]/route.ts"),
    report: await import("../../app/api/fleet/report/route.ts"),
  };
}

test("one inspection eligibility rule: listed roles when configured, Fleet access when not", async () => {
  const { server } = await load();
  const can = (permissions: string[], roleCodes: string[], inspectionRoles: string[]) => server.canSubmitFleetInspection({ permissions, roleCodes, isSuperAdmin: false }, { inspection_role_codes: inspectionRoles });
  for (const code of ["manage_fleet", "administer_department", "perform_fleet_inspections"]) {
    assert.equal(can([code], [], []), true, `${code}, no roles listed`);
    assert.equal(can([code], ["officer"], ["patrol"]), true, `${code}, roles listed`);
  }
  assert.equal(can([], ["officer"], []), false, "an empty list no longer admits members without Fleet access");
  assert.equal(can(["view_fleet"], ["officer"], []), true, "Fleet access with no roles listed");
  assert.equal(can([], ["officer"], ["officer"]), true, "a listed role");
  assert.equal(can(["view_fleet"], ["chief"], ["officer"]), false, "Fleet access alone once roles are listed");
  assert.equal(can(["manage_fleet_rules", "manage_fleet_maintenance"], ["mechanic"], ["officer"]), false, "rules or maintenance access is not inspection eligibility");
  assert.equal(server.canSubmitFleetInspection({ permissions: [], roleCodes: [], isSuperAdmin: false }, null), false, "no rules row is an empty list");
});

test("inspection route applies the eligibility rule", async () => {
  const { request, inspections } = await load();
  const submit = async (permissions: string[], roleCodes: string[], inspectionRoles: string[]) => {
    const db = createDb(fleet(inspectionRoles));
    signIn(db, permissions, roleCodes);
    const response = await inspections.POST(request(`/api/mobile/fleet/vehicles/${V}/inspections`, "POST", { checklist: checklist() }), params({ vehicleId: V }));
    return { status: response.status, inspections: db.tables.fleet_vehicle_inspections.length };
  };
  assert.deepEqual(await submit([], ["officer"], []), { status: 403, inspections: 0 }, "no Fleet access, no roles listed");
  assert.equal((await submit(["view_fleet"], ["officer"], [])).status, 201);
  assert.equal((await submit([], ["officer"], ["officer"])).status, 201);
  assert.deepEqual(await submit(["view_fleet"], ["chief"], ["officer"]), { status: 403, inspections: 0 });
  assert.deepEqual(await submit(["manage_fleet_rules"], ["chief"], ["officer"]), { status: 403, inspections: 0 });
  assert.equal((await submit(["perform_fleet_inspections"], ["chief"], ["officer"])).status, 201);
});

test("inspection response withholds defect work-order costs from inspectors", async () => {
  const { request, inspections } = await load();
  for (const [permissions, costs] of [[["perform_fleet_inspections"], false], [["manage_fleet_maintenance", "perform_fleet_inspections"], true]] as const) {
    const db = createDb(fleet());
    signIn(db, [...permissions]);
    const response = await inspections.POST(request(`/api/mobile/fleet/vehicles/${V}/inspections`, "POST", { checklist: checklist("controls") }), params({ vehicleId: V }));
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.ok(body.workOrder, "defect work order returned");
    if (costs) assert.equal("total_cost" in body.workOrder, true);
    else noCosts(body.workOrder, "inspector response");
  }
});

test("issue reports use the eligibility rule and grant no maintenance fields", async () => {
  const { request, workOrders } = await load();
  const report = async (permissions: string[], roleCodes: string[], inspectionRoles: string[], body: Row = {}) => {
    const db = createDb(fleet(inspectionRoles));
    signIn(db, permissions, roleCodes);
    const response = await workOrders.POST(request(`/api/fleet/vehicles/${V}/work-orders`, "POST", { recordType: "Issue", title: "Brakes grinding", ...body }), params({ vehicleId: V }));
    return { response, db };
  };
  assert.equal((await report([], ["officer"], [])).response.status, 403, "no Fleet access, no roles listed");
  assert.equal((await report(["view_fleet"], ["chief"], ["officer"])).response.status, 403, "not a listed role");
  assert.equal((await report(["view_fleet"], ["officer"], [])).response.status, 201);
  const { response, db } = await report([], ["officer"], ["officer"], { mileage: 19300, nextServiceDate: "2027-01-01", nextServiceMileage: 25000, laborCost: 50, totalCost: 75, mechanicName: "Me", vendor: "Shop", status: "Completed" });
  const body = await response.json();
  assert.equal(response.status, 201);
  noCosts(body.item, "issue response");
  const saved = db.tables.fleet_work_orders.at(-1)!;
  assert.deepEqual([saved.status, saved.labor_cost, saved.total_cost, saved.mechanic_name, saved.vendor], ["Open", null, null, null, null]);
  assert.equal(db.tables.fleet_vehicles[0].current_mileage, 19300, "a higher reading still advances the odometer");
  assert.equal(db.tables.fleet_vehicles[0].next_service_date, undefined, "issue reporters do not set service schedules");
  assert.equal(db.tables.fleet_vehicles[0].next_service_mileage, undefined);
  const mechanic = await report(["manage_fleet_maintenance"], ["mechanic"], ["officer"], { nextServiceDate: "2027-01-01" });
  assert.equal(mechanic.response.status, 201, "maintainers still report issues");
  assert.equal(mechanic.db.tables.fleet_vehicles[0].next_service_date, "2027-01-01");
  assert.equal("total_cost" in (await mechanic.response.json()).item, true);
});

test("vehicle detail (web and mobile) and the fleet report withhold costs without fleet cost access", async () => {
  const { request, vehicleRoute, mobileVehicleRoute, report } = await load();
  for (const [permissions, costs] of [
    [["perform_fleet_inspections"], false], [["view_fleet"], false],
    [["manage_fleet_maintenance"], true], [["manage_fleet"], true], [["administer_department"], true],
  ] as const) {
    for (const [route, url] of [[vehicleRoute, `/api/fleet/vehicles/${V}`], [mobileVehicleRoute, `/api/mobile/fleet/vehicles/${V}`]] as const) {
      const db = createDb(fleet());
      signIn(db, [...permissions]);
      const response = await route.GET(request(url), params({ vehicleId: V }));
      const body = await response.json();
      assert.equal(response.status, 200, `${permissions} ${url}`);
      const [workOrder] = body.workOrders;
      assert.equal(workOrder.vendor, "Main St Garage");
      const selected = db.selections.filter(([table]) => table === "fleet_work_orders").map(([, columns]) => columns);
      if (costs) {
        assert.equal(workOrder.total_cost, 200, `${permissions} sees costs`);
        assert.equal(body.history[0].details.previous.total_cost, 150);
      } else {
        noCosts(workOrder, `${permissions} ${url} work order`);
        noCosts(body.history[0].details.previous, `${permissions} history`);
        noCosts(body.history[0].details.current, `${permissions} history`);
        assert.ok(selected.every((columns) => columns !== "*" && COSTS.every((field) => !columns.split(",").includes(field))), "cost columns are not selected");
      }
    }
  }
  for (const [permissions, costs] of [[["view_fleet"], false], [["view_fleet", "manage_fleet_maintenance"], true]] as const) {
    const db = createDb(fleet());
    signIn(db, [...permissions]);
    const body = await (await report.GET()).json();
    if (costs) assert.equal(body.workOrders[0].total_cost, 200);
    else noCosts(body.workOrders[0], `${permissions} report`);
  }
});

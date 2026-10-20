import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createMockDb, ctx } from "./mockdb.ts";
import { numeric, refreshFleetVehicle } from "../src/lib/tracepoint/fleet-server.ts";
import { buildTracePointQrValue } from "../src/lib/tracepoint/qr-identifiers.ts";
import { POST as inspect } from "../src/app/api/fleet/vehicles/[vehicleId]/inspections/route.ts";
import { POST as woPost, PATCH as woPatch } from "../src/app/api/fleet/vehicles/[vehicleId]/work-orders/route.ts";
import { PATCH as vehiclePatch } from "../src/app/api/fleet/vehicles/[vehicleId]/route.ts";
import { POST as qrResolve } from "../src/app/api/mobile/qr/resolve/route.ts";
import { GET as custodyGet } from "../src/app/api/equipment/custody/route.ts";
import { POST as evidencePost } from "../src/app/api/fleet/vehicles/[vehicleId]/inspections/[inspectionId]/evidence/route.ts";

const V = "11111111-1111-4111-8111-111111111111";
const EQ = "22222222-2222-4222-8222-222222222222";
const params = (p: any) => ({ params: Promise.resolve(p) });
const json = (url: string, method: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const vehicle = (over: any = {}) => ({ id: V, department_id: "dept-1", unit_number: "3101", status: "Available", status_override_active: false, current_mileage: 19200, current_hours: 0, ...over });
const fullChecklist = (critical?: string) => ["body", "tires", "lights", "controls", "fluids", "interior"].map((id) => id === critical ? { id, condition: "Critical", note: "Brakes fail" } : { id, condition: "Pass" });
const MANAGER = ["manage_fleet", "view_fleet", "perform_fleet_inspections", "manage_fleet_maintenance"];

test("T1 FLT-01 refreshFleetVehicle: override_active suppresses Out of Service for an open Critical work order", async () => {
  const db = createMockDb({ fleet_rules: [], fleet_vehicles: [vehicle({ status_override_active: true })], fleet_work_orders: [{ id: "wo", department_id: "dept-1", vehicle_id: V, priority: "Critical", status: "Open", affects_availability: true }], fleet_vehicle_equipment: [] });
  const out = await refreshFleetVehicle({ admin: db, departmentId: "dept-1" }, V);
  console.log("T1 override=true ->", out);
  assert.equal(out.status, "Available");
  db.tables.fleet_vehicles[0].status_override_active = false;
  const control = await refreshFleetVehicle({ admin: db, departmentId: "dept-1" }, V);
  console.log("T1 override=false ->", control);
  assert.equal(control.status, "Out of Service");
});

test("T1b FLT-01 end-to-end: manager sets Available via [vehicleId] PATCH, then a Critical brake inspection leaves the vehicle Available", async () => {
  const db = createMockDb({ fleet_rules: [], fleet_vehicles: [vehicle({ status: "Maintenance" })], fleet_work_orders: [], fleet_vehicle_equipment: [], audit_events: [], fleet_vehicle_inspections: [] });
  (globalThis as any).__access = ctx(db, { permissions: MANAGER });
  const p = await vehiclePatch(json(`/api/fleet/vehicles/${V}`, "PATCH", { status: "Available", reason: "repaired" }), params({ vehicleId: V }));
  assert.equal(p.status, 200);
  console.log("T1b after PATCH status=Available: override_active =", db.tables.fleet_vehicles[0].status_override_active);
  const r = await inspect(json(`/api/mobile/fleet/vehicles/${V}/inspections`, "POST", { checklist: fullChecklist("controls"), mileage: 19250 }), params({ vehicleId: V }));
  const body = await r.json();
  console.log("T1b inspection ->", r.status, "workOrder.priority:", body.workOrder?.priority, "readiness:", body.readiness, "vehicle.status:", db.tables.fleet_vehicles[0].status);
  assert.equal(body.workOrder.priority, "Critical");
  assert.equal(db.tables.fleet_vehicles[0].status, "Available");
  // Does any path clear it? Only body.clearStatusOverride===true on [vehicleId] PATCH.
  await vehiclePatch(json(`/api/fleet/vehicles/${V}`, "PATCH", { clearStatusOverride: true, reason: "resume" }), params({ vehicleId: V }));
  console.log("T1b after clearStatusOverride:true ->", db.tables.fleet_vehicles[0].status, db.tables.fleet_vehicles[0].status_override_active);
  assert.equal(db.tables.fleet_vehicles[0].status, "Out of Service");
});

test("T2 FLT-02 work-order PATCH rolls the odometer back to the work order's reported mileage", async () => {
  const db = createMockDb({ fleet_rules: [], fleet_vehicles: [vehicle()], fleet_work_orders: [{ id: "wo1", department_id: "dept-1", vehicle_id: V, record_type: "Repair", title: "x", priority: "Normal", status: "Open", mileage: 18000 }], fleet_vehicle_equipment: [], audit_events: [] });
  (globalThis as any).__access = ctx(db, { permissions: ["manage_fleet_maintenance"] });
  const r = await woPatch(json(`/api/fleet/vehicles/${V}/work-orders`, "PATCH", { id: "wo1", reason: "close", status: "Completed", mileage: 18000 }), params({ vehicleId: V }));
  console.log("T2 PATCH ->", r.status, "current_mileage:", db.tables.fleet_vehicles[0].current_mileage, "last_service_mileage:", db.tables.fleet_vehicles[0].last_service_mileage);
  assert.equal(db.tables.fleet_vehicles[0].current_mileage, 18000);
});

test("T3 FLT-09/FLT-14 officer Issue POST with a cleared mileage field zeroes the odometer (no permission needed)", async () => {
  const db = createMockDb({ fleet_rules: [], fleet_vehicles: [vehicle()], fleet_work_orders: [], fleet_vehicle_equipment: [], audit_events: [] });
  (globalThis as any).__access = ctx(db, { permissions: [] });
  const r = await woPost(json(`/api/fleet/vehicles/${V}/work-orders`, "POST", { recordType: "Issue", title: "Dent", mileage: "", nextServiceMileage: 1 }), params({ vehicleId: V }));
  console.log("T3 ->", r.status, "current_mileage:", db.tables.fleet_vehicles[0].current_mileage, "next_service_mileage:", db.tables.fleet_vehicles[0].next_service_mileage);
  assert.equal(r.status, 201);
  assert.equal(db.tables.fleet_vehicles[0].current_mileage, 0);
});

test("T4 FLT-09 numeric(): blank/null mileage become 0, not the fallback; inspection record stores 0", async () => {
  const cases = { emptyString: numeric("", 19200), nullValue: numeric(null, 19200), undefinedValue: numeric(undefined, 19200), whitespace: numeric("  ", 19200) };
  console.log("T4 numeric(x, 19200) ->", cases);
  assert.deepEqual(cases, { emptyString: 0, nullValue: 0, undefinedValue: 19200, whitespace: 0 });
  const db = createMockDb({ fleet_rules: [], fleet_vehicles: [vehicle()], fleet_work_orders: [], fleet_vehicle_equipment: [], audit_events: [], fleet_vehicle_inspections: [] });
  (globalThis as any).__access = ctx(db, { permissions: ["perform_fleet_inspections"] });
  const r = await inspect(json(`/api/mobile/fleet/vehicles/${V}/inspections`, "POST", { checklist: fullChecklist(), mileage: null }), params({ vehicleId: V }));
  const body = await r.json();
  console.log("T4 mobile JSON mileage:null -> inspection.mileage =", body.inspection?.mileage, "vehicle current_mileage =", db.tables.fleet_vehicles[0].current_mileage);
  assert.equal(body.inspection.mileage, 0);
});

test("T5 FLT-04 mobile QR resolve rejects the printed label payload and HTTPS deep links; accepts only bare identifiers", async () => {
  const db = createMockDb({ fleet_vehicles: [vehicle()], equipment_assets: [{ id: EQ, department_id: "dept-1", lifecycle_status: "active", asset_number: "A-42", manufacturer: "Axon", model: "T7" }], firearms: [] });
  (globalThis as any).__access = ctx(db, { permissions: ["perform_fleet_inspections"] });
  const label = buildTracePointQrValue("vehicle", V);
  const inputs = [label, buildTracePointQrValue("equipment", EQ), `https://app.tracepoint.example/fleet-management/${V}`, V, "3101", EQ, "A-42", "asset 42"];
  for (const identifier of inputs) {
    const r = await qrResolve(new Request("http://localhost/api/mobile/qr/resolve", { method: "POST", body: JSON.stringify({ identifier }) }));
    const b = await r.json();
    console.log(`T5 resolve(${JSON.stringify(identifier)}) -> ${r.status} ${JSON.stringify(b)}`);
    if (identifier === label) assert.equal(r.status, 400);
    if (identifier === V) assert.equal(b.entityType, "vehicle");
  }
});

test("T6 FLT-04/EQP-06 custody lookup does not accept the tracepoint://equipment/ label value", async () => {
  const db = createMockDb({ equipment_assets: [{ id: EQ, department_id: "dept-1", lifecycle_status: "active", asset_number: "A-42", serial_number: "SN1" }], equipment_asset_assignments: [], profiles: [] });
  (globalThis as any).__access = { context: (ctx(db) as any).context };
  for (const id of [buildTracePointQrValue("equipment", EQ), EQ, "a-42"]) {
    const r = await custodyGet(new NextRequest(`http://localhost/api/mobile/equipment/custody?identifier=${encodeURIComponent(id)}`));
    console.log(`T6 custody GET identifier=${id} -> ${r.status}`);
  }
});

test("T7 FLT-07 repeated inspections of the same known defect create duplicate work orders", async () => {
  const db = createMockDb({ fleet_rules: [], fleet_vehicles: [vehicle()], fleet_work_orders: [], fleet_vehicle_equipment: [], audit_events: [], fleet_vehicle_inspections: [] });
  (globalThis as any).__access = ctx(db, { permissions: ["perform_fleet_inspections"] });
  const cl = fullChecklist().map((i) => i.id === "body" ? { id: "body", condition: "Defect", note: "cracked mirror" } : i);
  for (let n = 0; n < 3; n++) await inspect(json(`/api/fleet/vehicles/${V}/inspections`, "POST", { checklist: cl, mileage: 19300 + n }), params({ vehicleId: V }));
  console.log("T7 work orders after 3 identical inspections:", db.tables.fleet_work_orders.length);
  assert.equal(db.tables.fleet_work_orders.length, 3);
});

test("T8 NEW-01 simulation of AWS-native RLS (database/aws/018 + audit_events_insert_managers) for an inspector-only user", async () => {
  // Policies modelled from database/aws/018_fleet_and_off_duty_rls.sql and supabase/migrations/20260721_permissions_rls_hardening_v1.sql:958-976
  const inspectorPolicy = (t: string, op: string) => {
    if (t === "fleet_work_orders") return false; // read: view_fleet/manage_fleet/manage_fleet_maintenance; write: manage_fleet_maintenance
    if (t === "fleet_vehicles" && op !== "select") return false; // manage_fleet
    if (t === "fleet_vehicle_equipment" && op !== "select") return false; // manage_fleet
    if (t === "audit_events" && op === "insert") return false; // manage_users/firearms/inspections/range_days/qualifications/review_off_duty/administer only
    return true;
  };
  const db = createMockDb({ fleet_rules: [], fleet_vehicles: [vehicle()], fleet_work_orders: [], fleet_vehicle_equipment: [], audit_events: [], fleet_vehicle_inspections: [] }, { policy: inspectorPolicy });
  (globalThis as any).__access = ctx(db, { permissions: ["perform_fleet_inspections"] });
  let outcome: string;
  try { const r = await inspect(json(`/api/mobile/fleet/vehicles/${V}/inspections`, "POST", { checklist: fullChecklist("controls"), mileage: 19400 }), params({ vehicleId: V })); outcome = `HTTP ${r.status}`; }
  catch (e: any) { outcome = `handler threw (Next returns 500): ${e.message}`; }
  console.log("T8 outcome:", outcome);
  console.log("T8 inspections persisted:", db.tables.fleet_vehicle_inspections.length, "work orders:", db.tables.fleet_work_orders.length, "vehicle status:", db.tables.fleet_vehicles[0].status, "inspection_due_date:", db.tables.fleet_vehicles[0].inspection_due_date ?? null);
  assert.equal(db.tables.fleet_vehicle_inspections.length, 1);
  assert.equal(db.tables.fleet_work_orders.length, 0);
});

test("T9 FLT-03 evidence POST: accepted for a checklist item id that is not on the inspection", async () => {
  const db = createMockDb({ fleet_rules: [], fleet_vehicle_inspections: [{ id: "insp1", department_id: "dept-1", vehicle_id: V, inspector_user_id: "user-1", checklist: [{ id: "body" }] }], attachments: [], audit_events: [] });
  (globalThis as any).__access = ctx(db, { permissions: [], roleCodes: [] });
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "dent.jpg", { type: "image/jpeg" }));
  form.set("checklistItemId", "not-a-real-item"); form.set("checklistItemLabel", "Anything");
  const r = await evidencePost(new NextRequest(`http://localhost/api/mobile/fleet/vehicles/${V}/inspections/insp1/evidence`, { method: "POST", body: form }), params({ vehicleId: V, inspectionId: "insp1" }));
  console.log("T9 ->", r.status, JSON.stringify(await r.json()));
  assert.equal(r.status, 201);
});

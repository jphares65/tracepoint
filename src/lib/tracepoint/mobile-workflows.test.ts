import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PostgresDataClient } from "../database/postgres-data-client.ts";
import { lookupQrRecords, parseQrIdentifier, qrDecision, qrLookupFilter, rangeDayDetailPayload, rangeDayPayload } from "./mobile-workflows.ts";
import { buildTracePointQrValue } from "./qr-identifiers.ts";

const access = { permissions: ["score_range_days", "perform_fleet_inspections"] as never[], enabledFeatures: ["fleet", "equipment_readiness"] };
test("mobile range days separate and preserve ordered drills with document availability", () => {
  const workspace = { rangeDays: [{ id: "today", title: "Today", date: "2026-10-06", status: "Planned" }], rangeDayDrills: [{ id: "two", rangeDayId: "today", name: "Two", sortOrder: 2, sourceTemplateId: "template" }, { id: "one", rangeDayId: "today", name: "One", sortOrder: 1 }], rangeRoster: [{ id: "r", rangeDayId: "today", officerId: "officer", attended: true }] };
  assert.equal(rangeDayPayload(workspace)[0].id, "today");
  const detail = rangeDayDetailPayload(workspace, "today", new Map([["template", ["document"]]]));
  assert.deepEqual(detail?.drills.map((drill) => drill.id), ["one", "two"]);
  assert.equal(detail?.drills[1].documentId, "document");
});
test("QR decisions do not disclose an unauthorized firearm", () => {
  assert.deepEqual(qrDecision({ identifier: "qr", access, vehicle: { id: "v", unit_number: "12" } }), { entityType: "vehicle", entityId: "v", displayName: "Unit 12", workflow: "vehicle_inspection", allowed: true });
  assert.equal(qrDecision({ identifier: "qr", access: { permissions: [] as never[], enabledFeatures: [] }, firearm: { id: "f" } }).status, "denied");
  assert.equal(qrDecision({ identifier: "", access }).status, "unknown");
});

const record = "11111111-0000-4000-8000-000000000001";
const department = "20000000-0000-4000-8000-000000000001";
const officer = "30000000-0000-4000-8000-000000000001";
const adminAccess = { userId: officer, permissions: ["administer_department"] as never[], enabledFeatures: ["fleet", "equipment_readiness", "firearms"] };
// Stands in for the bridge-mode service-role client: no RLS, rows are returned whatever the caller may read.
// Rows carrying a department_id are returned only when that department is bound into the statement.
function qrClient(rowsByTable: Record<string, Record<string, unknown>[]> = {}) {
  const statements: Array<{ text: string; values?: readonly unknown[] }> = [];
  const connection = {
    async query(text: string, values?: readonly unknown[]) {
      if (!text.startsWith("select ") || text.includes("set_config")) return { rows: [], rowCount: 0 };
      statements.push({ text, values });
      const rows = (rowsByTable[/from public\."([a-z_]+)"/.exec(text)?.[1] ?? ""] ?? []).filter((row) => !row.department_id || values?.includes(row.department_id));
      return { rows, rowCount: rows.length };
    },
    release() {},
  };
  return { admin: new PostgresDataClient({ async connect() { return connection; } } as never, record, department), statements };
}

test("QR resolver accepts the printed label value and every previously accepted handle", () => {
  assert.deepEqual(parseQrIdentifier(buildTracePointQrValue("vehicle", record)), { handle: record, kind: "vehicle" });
  assert.deepEqual(parseQrIdentifier(buildTracePointQrValue("equipment", "EQ-0042")), { handle: "EQ-0042", kind: "equipment" });
  assert.deepEqual(parseQrIdentifier("TRACEPOINT://Equipment/EQ-0042/"), { handle: "EQ-0042", kind: "equipment" });
  for (const handle of [record, "3101", "FA-0001", "SN.12:3_4", "1HGCM82633A004352"]) assert.deepEqual(parseQrIdentifier(handle), { handle, kind: null });
  for (const value of ["", "https://app.example/q/firearm/" + record, "tracepoint://firearm/" + record, "tracepoint://vehicle/", "tracepoint://vehicle/a/b", buildTracePointQrValue("equipment", "asset 42"), "tracepoint://vehicle/%E0%A4%A", "unit 12", "a,id.neq.x", "tracepoint://vehicle/a%2Cid.neq.x"]) assert.equal(parseQrIdentifier(value), null, value);
});

test("QR lookup compares only UUID handles to uuid id columns", () => {
  assert.equal(qrLookupFilter("3101", ["unit_number", "vin"]), "unit_number.eq.3101,vin.eq.3101");
  assert.equal(qrLookupFilter(record, ["unit_number", "vin"]), `id.eq.${record},unit_number.eq.${record},vin.eq.${record}`);
});

test("QR lookup SQL never binds a non-UUID handle to an id comparison", async () => {
  const value = qrClient({ firearms: [{ id: record, asset_number: "FA-0001" }] });
  const result = await lookupQrRecords(value.admin, department, { handle: "FA-0001", kind: null }, adminAccess);
  assert.deepEqual(result, { vehicle: null, equipment: null, firearm: { id: record, asset_number: "FA-0001" }, firearmCustodyEligible: false });
  assert.equal(value.statements.length, 3);
  for (const statement of value.statements) {
    assert.doesNotMatch(statement.text, /t\."id" =/);
    // No limit: a row the caller cannot see must never crowd out one they can.
    assert.doesNotMatch(statement.text, / limit /);
    assert.deepEqual(statement.values?.slice(-2), ["FA-0001", "FA-0001"]);
  }
  const uuidLookup = qrClient();
  await lookupQrRecords(uuidLookup.admin, department, { handle: record, kind: null }, adminAccess);
  for (const statement of uuidLookup.statements) assert.match(statement.text, /\(t\."id" = \$\d+ or /);
});

test("QR lookup honours the label kind and reports duplicate matches as ambiguous", async () => {
  const labelled = qrClient({ fleet_vehicles: [{ id: record, unit_number: "12" }] });
  assert.deepEqual(await lookupQrRecords(labelled.admin, department, { handle: record, kind: "vehicle" }, adminAccess), { vehicle: { id: record, unit_number: "12" }, equipment: null, firearm: null, firearmCustodyEligible: false });
  assert.deepEqual(labelled.statements.map((statement) => /from public\."([a-z_]+)"/.exec(statement.text)?.[1]), ["fleet_vehicles"]);
  const duplicated = qrClient({ equipment_assets: [{ id: "a" }, { id: "b" }] });
  assert.deepEqual(await lookupQrRecords(duplicated.admin, department, { handle: "SN-1", kind: null }, adminAccess), { failure: "ambiguous" });
});

async function resolveAs(client: ReturnType<typeof qrClient>, handle: string, caller: { userId: string; permissions: string[]; enabledFeatures: string[]; restrictedFirearmCustody?: boolean }) {
  const access = { ...caller, permissions: caller.permissions as never[] };
  const records = await lookupQrRecords(client.admin, department, { handle, kind: null }, access);
  return "failure" in records ? records : qrDecision({ identifier: handle, access, ...records });
}
const member = (...permissions: string[]) => ({ userId: officer, permissions, enabledFeatures: ["fleet", "equipment_readiness", "firearms"] });
const notFound = { status: "unknown", message: "This QR code is unknown, inactive, or unavailable." };

test("QR resolution answers an unreadable in-agency firearm exactly like a missing one", async () => {
  const firearms = { firearms: [{ id: record, department_id: department, serial_number: "SN-1" }] };
  assert.deepEqual(await resolveAs(qrClient(firearms), "SN-1", member("perform_fleet_inspections")), notFound);
  assert.deepEqual(await resolveAs(qrClient(firearms), "NOPE-1", member("perform_fleet_inspections")), notFound);
  // Read permission without custody permission: the caller may know the firearm exists, so the restriction is stated, without its ID.
  assert.deepEqual(await resolveAs(qrClient(firearms), "SN-1", member("manage_inspections")), { status: "denied", message: "You are not authorized to use firearm custody." });
  // The officer holding the firearm can read it (firearms_select_scoped), so the restriction is stated too.
  assert.deepEqual(await resolveAs(qrClient({ ...firearms, firearm_assignments: [{ firearm_id: record, assigned_to_user_id: officer }] }), "SN-1", member()), { status: "denied", message: "You are not authorized to use firearm custody." });
  assert.deepEqual(await resolveAs(qrClient(firearms), "SN-1", member("firearm_custody.check_out")), notFound);
  assert.deepEqual(await resolveAs(qrClient(firearms), "SN-1", member("manage_firearms")), { entityType: "firearm", entityId: record, workflow: "firearm_custody", allowed: true, displayName: "Firearm", matchedField: "serial_number", matchedValue: "SN-1" });
});

test("QR resolution answers another agency's record exactly like a missing one", async () => {
  const other = "20000000-0000-4000-8000-000000000002";
  const client = qrClient({ firearms: [{ id: record, department_id: other, serial_number: "SN-1" }], fleet_vehicles: [{ id: record, department_id: other, unit_number: "12" }], equipment_assets: [{ id: record, department_id: other, serial_number: "SN-1", lifecycle_status: "active" }] });
  assert.deepEqual(await resolveAs(client, "SN-1", member("administer_department")), notFound);
  assert.deepEqual(await resolveAs(client, "12", member("administer_department")), notFound);
  for (const statement of client.statements) assert.ok(statement.values?.includes(department) && !statement.values.includes(other));
});

test("QR resolution hides vehicles and equipment the caller cannot read", async () => {
  const vehicles = qrClient({ fleet_vehicles: [{ id: record, department_id: department, unit_number: "12" }] });
  assert.deepEqual(await resolveAs(vehicles, "12", member()), notFound);
  assert.deepEqual(await resolveAs(vehicles, "12", member("view_command_dashboard")), { status: "denied", message: "You are not authorized to use this vehicle workflow." });
  const held = { id: record, department_id: department, serial_number: "SN-1", lifecycle_status: "active", assigned_user_id: "30000000-0000-4000-8000-000000000009" };
  assert.deepEqual(await resolveAs(qrClient({ equipment_assets: [held] }), "SN-1", member()), notFound);
  assert.equal((await resolveAs(qrClient({ equipment_assets: [{ ...held, assigned_user_id: officer }] }), "SN-1", member()) as { entityId?: string }).entityId, record);
  assert.equal((await resolveAs(qrClient({ equipment_assets: [{ ...held, assigned_user_id: null }] }), "SN-1", member()) as { entityId?: string }).entityId, record);
  assert.equal((await resolveAs(qrClient({ equipment_assets: [held] }), "SN-1", member("manage_equipment")) as { entityId?: string }).entityId, record);
});

test("QR ambiguity is reported only over records the caller can read and never selects one", async () => {
  const hidden = { department_id: department, serial_number: "SN-1" };
  assert.deepEqual(await resolveAs(qrClient({ firearms: [{ id: "a", ...hidden }, { id: "b", ...hidden }] }), "SN-1", member()), notFound);
  assert.deepEqual(await resolveAs(qrClient({ firearms: [{ id: "a", ...hidden }, { id: "b", ...hidden }] }), "SN-1", member("manage_firearms")), { failure: "ambiguous" });
  // One readable and one unreadable match resolves the readable one (owner decision F6b): hidden rows never change the answer.
  const pool = { ...hidden, lifecycle_status: "active", assigned_user_id: null };
  assert.equal((await resolveAs(qrClient({ equipment_assets: [{ id: "a", ...pool }, { id: "b", ...pool, assigned_user_id: "30000000-0000-4000-8000-000000000009" }] }), "SN-1", member()) as { entityId?: string }).entityId, "a");
  const route = await readFile("src/app/api/mobile/qr/resolve/route.ts", "utf8");
  assert.match(route, /records\.failure === "ambiguous"\s*\? NextResponse\.json\(\{ status: "unknown", message: "This code matches more than one record\. Scan the TracePoint label for this item instead\." \}, \{ status: 409/);
  assert.match(route, /lookupQrRecords\(admin, departmentId, parsed, access\)/);
});

// Fleet has no module entitlement in the feature catalog; agencies' enabled features never include "fleet".
const catalogFeatures = ["equipment_readiness", "firearms", "qualifications", "range_training"];
const vehicleRow = { id: record, department_id: department, unit_number: "12" };

test("vehicle QR scans do not depend on a nonexistent fleet feature flag", () => {
  const inspector = { permissions: ["perform_fleet_inspections"] as never[], enabledFeatures: catalogFeatures, vehicleInspectionEligible: true };
  assert.equal((qrDecision({ identifier: "12", access: inspector, vehicle: vehicleRow }) as { allowed?: boolean }).allowed, true);
});

test("vehicle QR decisions follow the fleet inspection-eligibility rule", async () => {
  // Eligible only through a configured inspection role: visible and allowed, even without fleet permissions.
  const roleEligible = { userId: officer, permissions: [] as never[], enabledFeatures: catalogFeatures, vehicleInspectionEligible: true };
  assert.equal((await resolveAs(qrClient({ fleet_vehicles: [vehicleRow] }), "12", roleEligible) as { allowed?: boolean }).allowed, true);
  // A fleet viewer whose role is not in the configured inspection roles may see the vehicle but is not offered an inspection.
  const viewerNotEligible = { userId: officer, permissions: ["view_fleet"] as never[], enabledFeatures: catalogFeatures, vehicleInspectionEligible: false };
  assert.deepEqual(await resolveAs(qrClient({ fleet_vehicles: [vehicleRow] }), "12", viewerNotEligible), { status: "denied", message: "You are not authorized to use this vehicle workflow." });
  const route = await readFile("src/app/api/mobile/qr/resolve/route.ts", "utf8");
  assert.match(route, /admin\.rpc\("can_submit_fleet_inspection", \{ p_department_id: departmentId \}\)/);
  assert.match(route, /canSubmitFleetInspection\(resolved\.context, rules\.data\)/);
});

async function resolveTraced(rowsByTable: Record<string, Record<string, unknown>[]>, handle: string, caller: { userId: string; permissions: string[]; enabledFeatures: string[]; restrictedFirearmCustody?: boolean }) {
  const client = qrClient(rowsByTable);
  return { response: await resolveAs(client, handle, caller), statements: client.statements.map((statement) => statement.text) };
}
const otherOfficer = "30000000-0000-4000-8000-000000000009";

test("QR responses are identical whether or not a hidden record shares the handle", async () => {
  const pool = { id: "a", department_id: department, serial_number: "SN-1", lifecycle_status: "active", assigned_user_id: null };
  const heldByOther = (id: string) => ({ ...pool, id, assigned_user_id: otherOfficer });
  const held = { id: "f", department_id: department, asset_number: "FA-1", serial_number: "X-1" };
  const cases: Array<[string, Record<string, Record<string, unknown>[]>, Record<string, Record<string, unknown>[]>, string, ReturnType<typeof member>]> = [
    ["equipment, one hidden duplicate", { equipment_assets: [pool] }, { equipment_assets: [pool, heldByOther("b")] }, "SN-1", member()],
    ["equipment, hidden rows that would fill a two-row page", { equipment_assets: [pool] }, { equipment_assets: [heldByOther("b"), heldByOther("c"), pool] }, "SN-1", member()],
    ["firearm held by the caller, hidden firearm with the same asset number", { firearms: [held], firearm_assignments: [{ firearm_id: "f", assigned_to_user_id: officer }] }, { firearms: [held, { ...held, id: "g", serial_number: "X-2" }], firearm_assignments: [{ firearm_id: "f", assigned_to_user_id: officer }] }, "FA-1", member()],
    ["only hidden matches versus none", {}, { firearms: [held, { ...held, id: "g" }], equipment_assets: [heldByOther("b")] }, "FA-1", member()],
  ];
  for (const [name, without, withHidden, handle, caller] of cases) {
    const plain = await resolveTraced(without, handle, caller), hidden = await resolveTraced(withHidden, handle, caller);
    assert.deepEqual(hidden.response, plain.response, name);
    assert.deepEqual(hidden.statements, plain.statements, `${name}: the same statements run`);
  }
  assert.deepEqual((await resolveTraced(cases[3][2], "FA-1", member())).response, notFound);
});

test("QR handles that match more than one visible record are ambiguous", async () => {
  const pool = { department_id: department, serial_number: "SN-1", lifecycle_status: "active", assigned_user_id: null };
  assert.deepEqual(await resolveAs(qrClient({ equipment_assets: [{ id: "a", ...pool }, { id: "b", ...pool }] }), "SN-1", member()), { failure: "ambiguous" });
  const firearm = { department_id: department, serial_number: "SN-1" };
  assert.deepEqual(await resolveAs(qrClient({ firearms: [{ id: "a", ...firearm }, { id: "b", ...firearm, serial_number: "X", asset_number: "SN-1" }] }), "SN-1", member("manage_firearms")), { failure: "ambiguous" });
});

test("QR resolution follows the restricted firearm custody operator rule (031) on AWS-native", async () => {
  const firearm = { id: record, department_id: department, serial_number: "SN-1", asset_number: "FA-1", make: "Glock", model: "17" };
  const restriction = (type: string, extra: Record<string, unknown> = {}) => ({ firearm_id: record, department_id: department, restriction_type: type, effective_start: new Date(Date.now() - 60_000), expires_at: null, ...extra });
  const assignedTo = (user: string) => [{ firearm_id: record, department_id: department, assigned_to_user_id: user }];
  const aws = (...permissions: string[]) => ({ ...member(...permissions), restrictedFirearmCustody: true });
  const allowed = { entityType: "firearm", entityId: record, workflow: "firearm_custody", allowed: true, displayName: "Glock 17", matchedField: "serial_number", matchedValue: "SN-1" };
  const dutyOnly = { firearms: [firearm], firearm_assignments: assignedTo(otherOfficer), firearm_possession_restrictions: [restriction("duty_only")] };
  // manage_restricted_firearm_custody may check another officer's Duty Only firearm in or out, so it resolves.
  assert.deepEqual(await resolveAs(qrClient(dutyOnly), "SN-1", aws("manage_restricted_firearm_custody")), allowed);
  assert.deepEqual(await resolveAs(qrClient(dutyOnly), record, aws("manage_restricted_firearm_custody")), { entityType: "firearm", entityId: record, workflow: "firearm_custody", allowed: true });
  // The assignee operates their own Duty Only firearm.
  assert.deepEqual(await resolveAs(qrClient({ ...dutyOnly, firearm_assignments: assignedTo(officer) }), "SN-1", aws()), allowed);
  // Without that authority the same firearm answers exactly like a missing one.
  assert.deepEqual(await resolveAs(qrClient(dutyOnly), "SN-1", aws()), notFound);
  assert.deepEqual(await resolveAs(qrClient(dutyOnly), "SN-1", aws("firearm_custody.check_out")), notFound);
  // The custody function refuses these, so they are not offered either.
  for (const rows of [
    { ...dutyOnly, firearm_possession_restrictions: [restriction("no_carry")] },
    { ...dutyOnly, firearm_possession_restrictions: [restriction("duty_only", { effective_start: new Date(Date.now() + 86_400_000) })] },
    { ...dutyOnly, firearm_possession_restrictions: [restriction("duty_only", { expires_at: new Date(Date.now() - 1_000) })] },
    { ...dutyOnly, firearm_assignments: [] },
  ]) assert.deepEqual(await resolveAs(qrClient(rows), "SN-1", aws("manage_restricted_firearm_custody")), notFound);
  // A reader without custody authority still gets the ID-free denial.
  assert.deepEqual(await resolveAs(qrClient(dutyOnly), "SN-1", aws("manage_inspections")), { status: "denied", message: "You are not authorized to use firearm custody." });
  // Another agency's restricted firearm stays unknown.
  const other = "20000000-0000-4000-8000-000000000002";
  const foreign = { firearms: [{ ...firearm, department_id: other }], firearm_assignments: [{ ...assignedTo(otherOfficer)[0], department_id: other }], firearm_possession_restrictions: [restriction("duty_only", { department_id: other })] };
  assert.deepEqual(await resolveAs(qrClient(foreign), "SN-1", aws("manage_restricted_firearm_custody")), notFound);
  // Bridge mode has no restricted custody tables (Supabase lineage), so they are never queried there.
  const bridge = await resolveTraced(dutyOnly, "SN-1", member("manage_restricted_firearm_custody"));
  assert.deepEqual(bridge.response, notFound);
  assert.ok(!bridge.statements.some((statement) => statement.includes("firearm_possession_restrictions")));
  const route = await readFile("src/app/api/mobile/qr/resolve/route.ts", "utf8");
  assert.match(route, /restrictedFirearmCustody: awsNative/);
});

test("QR confirmation fields name only the matched identifier, and only on an allowed match", async () => {
  const vehicle = { id: record, department_id: department, unit_number: "12", vin: "1HGCM82633A004352", status: "active" };
  assert.deepEqual(await resolveAs(qrClient({ fleet_vehicles: [vehicle] }), "1HGCM82633A004352", member("perform_fleet_inspections")), { entityType: "vehicle", entityId: record, displayName: "Unit 12", workflow: "vehicle_inspection", allowed: true, matchedField: "vin", matchedValue: "1HGCM82633A004352" });
  assert.deepEqual(await resolveAs(qrClient({ fleet_vehicles: [vehicle] }), record, member("perform_fleet_inspections")), { entityType: "vehicle", entityId: record, displayName: "Unit 12", workflow: "vehicle_inspection", allowed: true });
  const asset = { id: record, department_id: department, manufacturer: "Motorola", model: "APX", serial_number: "RAD-1", asset_number: "EQ-1", lifecycle_status: "active", assigned_user_id: officer, assigned_location: "Locker 4" };
  assert.deepEqual(await resolveAs(qrClient({ equipment_assets: [asset] }), "EQ-1", member()), { entityType: "equipment", entityId: record, displayName: "Motorola APX", workflow: "equipment_custody", allowed: true, matchedField: "asset_number", matchedValue: "EQ-1" });
  const firearm = { id: record, department_id: department, serial_number: "SN-1", asset_number: "FA-1", make: "Glock", model: "17" };
  assert.deepEqual(await resolveAs(qrClient({ firearms: [firearm] }), "FA-1", member("manage_firearms")), { entityType: "firearm", entityId: record, workflow: "firearm_custody", allowed: true, displayName: "Glock 17", matchedField: "asset_number", matchedValue: "FA-1" });
  assert.deepEqual(await resolveAs(qrClient({ firearms: [firearm] }), record, member("manage_firearms")), { entityType: "firearm", entityId: record, workflow: "firearm_custody", allowed: true });
  // Denied and unknown answers carry no record detail.
  assert.deepEqual(await resolveAs(qrClient({ firearms: [firearm] }), "FA-1", member("manage_inspections")), { status: "denied", message: "You are not authorized to use firearm custody." });
  assert.deepEqual(await resolveAs(qrClient({ fleet_vehicles: [vehicle] }), "12", member("view_command_dashboard")), { status: "denied", message: "You are not authorized to use this vehicle workflow." });
  assert.deepEqual(await resolveAs(qrClient({ firearms: [firearm] }), "FA-1", member()), notFound);
});

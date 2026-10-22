/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Handler-level tests for B8 (armory integrity): the real route handlers run
// against an in-memory data client; only the session resolver, the server-only
// marker and the off-duty qualification readiness are replaced.
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__armoryAccess,
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  permissionDeniedResponse: (message: string) => Response.json({ error: message }, { status: 403 }),
  hasAnyServerPermission: (context: any, permissions: string[]) => permissions.some((permission) => context.permissions.includes(permission)),
  requireServerFeature: () => null,
});
stub(require.resolve("../tracepoint/off-duty-qualification-readiness.ts"), {
  getOfficerQualificationReadiness: async () => ({ status: "Current", statusReason: "test" }),
});
stub(require.resolve("../tracepoint/certification-capability.ts"), {
  evaluateCertificationCapability: async () => ({ configured: false, eligible: true }),
  certificationCapabilityDeniedResponse: () => Response.json({ error: "denied" }, { status: 403 }),
});

type Row = Record<string, any>;
function createDb(tables: Record<string, Row[]>) {
  const writes: Row[] = [];
  const rpcs: Row[] = [];
  function from(table: string) {
    tables[table] ??= [];
    const filters: ((row: Row) => boolean)[] = [];
    let op = "select"; let payload: any = null; let single: "one" | "maybe" | null = null; let returning = false; let limit = Infinity;
    const builder: any = {
      select() { if (op !== "select") returning = true; return builder; },
      eq(column: string, value: any) { filters.push((row) => String(row[column]) === String(value)); return builder; },
      neq(column: string, value: any) { filters.push((row) => row[column] !== value); return builder; },
      in(column: string, values: any[]) { filters.push((row) => values.map(String).includes(String(row[column]))); return builder; },
      is(column: string, value: any) { filters.push((row) => (row[column] ?? null) === value); return builder; },
      ilike(column: string, value: string) { filters.push((row) => String(row[column]).toLowerCase() === value.toLowerCase()); return builder; },
      order() { return builder; },
      limit(count: number) { limit = count; return builder; },
      maybeSingle() { single = "maybe"; return builder; },
      single() { single = "one"; return builder; },
      insert(value: any) { op = "insert"; payload = value; return builder; },
      upsert(value: any) { op = "upsert"; payload = value; return builder; },
      update(value: any) { op = "update"; payload = value; return builder; },
      delete() { op = "delete"; return builder; },
      then(resolve: any, reject: any) { return Promise.resolve(run()).then(resolve, reject); },
    };
    function shape(data: Row[]) {
      if (single === "one") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: "not one row" } };
      if (single === "maybe") return { data: data[0] ?? null, error: null };
      return { data, error: null };
    }
    function run() {
      const rows = tables[table];
      if (op === "insert" || op === "upsert") {
        const inserted: Row[] = (Array.isArray(payload) ? payload : [payload]).map((value: Row) => ({ id: `${table}-${rows.length + 1}-${Math.random().toString(36).slice(2, 6)}`, ...value }));
        if (op === "upsert") for (const value of inserted) { const index = rows.findIndex((row) => row.department_id === value.department_id); if (index >= 0) rows.splice(index, 1); }
        rows.push(...inserted); writes.push(...inserted.map((row) => ({ op, table, ...row })));
        return shape(inserted.map((row) => ({ ...row })));
      }
      const matched = rows.filter((row) => filters.every((filter) => filter(row))).slice(0, limit);
      if (op === "update") { writes.push({ op, table, ...payload }); for (const row of matched) Object.assign(row, payload); }
      if (op === "delete") { writes.push({ op, table }); tables[table] = rows.filter((row) => !matched.includes(row)); return { data: null, error: null }; }
      if ((op === "update") && !returning) return { data: null, error: null };
      return shape(matched.map((row) => ({ ...row })));
    }
    return builder;
  }
  return {
    from, tables, writes, rpcs,
    rpc: async (name: string, args: Row) => { rpcs.push({ name, ...args }); return { data: { ok: true }, error: null }; },
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } },
  };
}

const D = "dept-1";
const ARMORER = "user-armorer";
const OFFICER = "user-officer";
const CHIEF = "user-chief";

function world(tables: Record<string, Row[]>, user = ARMORER, permissions = ["manage_firearms", "manage_inspections"]) {
  const db = createDb(tables);
  (globalThis as any).__armoryAccess = { ok: true, context: { admin: db, db, departmentId: D, userId: user, user: { id: user }, fullName: `Name of ${user}`, primaryRoleLabel: "Role", permissions, enabledFeatures: ["firearms", "off_duty", "ammunition"] } };
  return db;
}

async function call(modulePath: string, method: string, url: string, body?: unknown, params?: Record<string, string>) {
  const { NextRequest } = await import("next/server");
  const route = await import(modulePath);
  const request = new NextRequest(`http://localhost${url}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  const response = await (route as any)[method](request, { params: Promise.resolve(params ?? {}) });
  return { status: response.status, body: await response.json() };
}

const firearm = (over: Row = {}) => ({ id: "fa-1", department_id: D, make: "Glock", model: "17", serial_number: "SN1", condition_status: "In Service", is_active: true, archived_at: null, archived_by_user_id: null, archive_reason: null, ...over });
const openAssignment = (over: Row = {}) => ({ id: "as-1", department_id: D, firearm_id: "fa-1", assigned_to_user_id: OFFICER, returned_at: null, magazines_issued: 3, ...over });

// ARM-06
test("ARM-06: an issued firearm archives as not returned with a reason, without a fictitious return", async () => {
  const route = "../../app/api/armory/firearms/[firearmId]/archive/route.ts";
  const db = world({ firearms: [firearm()], firearm_assignments: [openAssignment()] });

  const missing = await call(route, "PATCH", "/api/armory/firearms/fa-1/archive", { archiveReason: "Stolen" }, { firearmId: "fa-1" });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /why it was not returned/);
  assert.equal(db.tables.firearms[0].is_active, true);
  assert.equal(db.tables.firearm_assignments[0].returned_at, null);

  const archived = await call(route, "PATCH", "/api/armory/firearms/fa-1/archive", { archiveReason: "Reported stolen", notReturnedReason: "Stolen from residence, case 26-0142" }, { firearmId: "fa-1" });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  const assignment = db.tables.firearm_assignments[0];
  assert.ok(assignment.returned_at);
  assert.equal(assignment.condition_at_return, "Not Returned");
  assert.equal(assignment.magazines_returned, 0);
  assert.equal(assignment.magazine_discrepancy_reason, "Not returned: Stolen from residence, case 26-0142");
  assert.equal(assignment.returned_by_user_id, ARMORER);
  assert.equal(db.tables.firearms[0].is_active, false);
  assert.equal(db.tables.firearms[0].archive_reason, "Reported stolen");
});

test("ARM-06: an unassigned firearm still archives with only an archive reason", async () => {
  const db = world({ firearms: [firearm()], firearm_assignments: [] });
  const result = await call("../../app/api/armory/firearms/[firearmId]/archive/route.ts", "PATCH", "/x", { archiveReason: "Replaced" }, { firearmId: "fa-1" });
  assert.equal(result.status, 200);
  assert.equal(db.tables.firearms[0].is_active, false);
});

// ARM-13
test("ARM-13: restoring a firearm keeps its archive disposition", async () => {
  const db = world({ firearms: [firearm({ is_active: false, archived_at: "2026-10-01T00:00:00Z", archived_by_user_id: ARMORER, archive_reason: "Reported stolen" })] });
  const result = await call("../../app/api/armory/firearms/[firearmId]/restore/route.ts", "PATCH", "/x", undefined, { firearmId: "fa-1" });
  assert.equal(result.status, 200);
  const row = db.tables.firearms[0];
  assert.equal(row.is_active, true);
  assert.equal(row.archive_reason, "Reported stolen");
  assert.equal(row.archived_at, "2026-10-01T00:00:00Z");
  assert.equal(row.archived_by_user_id, ARMORER);
});

// ARM-11
test("ARM-11: an issued firearm cannot be retired; other status changes are recorded in the history", async () => {
  const route = "../../app/api/armory/firearms/[firearmId]/status/route.ts";
  const db = world({ firearms: [firearm()], firearm_assignments: [openAssignment()], firearm_status_history: [] });

  const retired = await call(route, "PATCH", "/x", { status: "Retired" }, { firearmId: "fa-1" });
  assert.equal(retired.status, 409);
  assert.match(retired.body.error, /Return it before retiring it/);
  assert.equal(db.tables.firearms[0].condition_status, "In Service");
  assert.equal(db.tables.firearm_status_history.length, 0);

  const outOfService = await call(route, "PATCH", "/x", { status: "Out of Service", notes: "Cracked frame" }, { firearmId: "fa-1" });
  assert.equal(outOfService.status, 200);
  assert.equal(db.tables.firearms[0].condition_status, "Out of Service");
  assert.deepEqual(
    db.tables.firearm_status_history.map((row) => [row.old_status, row.new_status, row.changed_by_user_id, row.notes]),
    [["In Service", "Out of Service", ARMORER, "Cracked frame"]],
  );

  db.tables.firearm_assignments[0].returned_at = "2026-10-20T00:00:00Z";
  const afterReturn = await call(route, "PATCH", "/x", { status: "Retired" }, { firearmId: "fa-1" });
  assert.equal(afterReturn.status, 200);
  assert.equal(db.tables.firearms[0].condition_status, "Retired");
});

// ARM-16 / ARM-17
const inspectionBody = (over: Row = {}) => ({ firearmId: "fa-1", inspectionType: "Routine", inspectionDate: "2026-10-20T12:00:00Z", result: "Passed", checklist: [{ label: "Slide", status: "Pass", critical: true }], ...over });

test("ARM-16: inspection result values and the critical-item rule are enforced by the server", async () => {
  const route = "../../app/api/armory/inspections/route.ts";
  const db = world({ firearms: [firearm()], firearm_inspections: [], firearm_inspection_items: [], firearm_status_history: [], profiles: [] });
  for (const [body, message] of [
    [inspectionBody({ result: "Pass" }), /result must be one of/],
    [inspectionBody({ checklist: [{ label: "Slide", status: "Fail", critical: true }] }), /cannot be marked Passed while critical/],
    [inspectionBody({ checklist: [{ label: "Slide", status: "OK" }] }), /must be Pass, Fail or N\/A/],
    [inspectionBody({ checklist: [{ status: "Pass" }] }), /needs a label/],
  ] as const) {
    const result = await call(route, "POST", "/api/armory/inspections", body);
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.match(result.body.error, message);
  }
  assert.equal(db.tables.firearm_inspections.length, 0);

  const failedNonCritical = await call(route, "POST", "/api/armory/inspections", inspectionBody({ checklist: [{ label: "Finish", status: "Fail", critical: false }] }));
  assert.equal(failedNonCritical.status, 200);
});

test("C-07: a resubmitted inspection (same request key) is recorded once, with one status change", async () => {
  const route = "../../app/api/armory/inspections/route.ts";
  const db = world({ firearms: [firearm()], firearm_inspections: [], firearm_inspection_items: [], firearm_status_history: [], profiles: [] });
  const body = inspectionBody({ result: "Failed", checklist: [{ label: "Slide", status: "Fail", critical: true }], idempotencyKey: "6f0c3a52-1c1e-4a8e-9a55-0d7f4b8f2a10" });
  const first = await call(route, "POST", "/api/armory/inspections", body);
  const second = await call(route, "POST", "/api/armory/inspections", body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.inspection.id, first.body.inspection.id);
  assert.equal(second.body.replayed, true);
  assert.equal(db.tables.firearm_inspections.length, 1);
  assert.equal(db.tables.firearm_inspections[0].idempotency_key, "6f0c3a52-1c1e-4a8e-9a55-0d7f4b8f2a10");
  assert.equal(db.tables.firearm_inspection_items.length, 1);
  assert.equal(db.tables.firearm_status_history.length, 1);

  const malformed = await call(route, "POST", "/api/armory/inspections", inspectionBody({ idempotencyKey: "again" }));
  assert.equal(malformed.status, 400);
  assert.equal(db.tables.firearm_inspections.length, 1);
});

test("ARM-17: inspection status changes are written to the status history, and a pass restores only what an inspection removed", async () => {
  const route = "../../app/api/armory/inspections/route.ts";
  const db = world({ firearms: [firearm()], firearm_inspections: [], firearm_inspection_items: [], firearm_status_history: [], profiles: [] });

  const failed = await call(route, "POST", "/api/armory/inspections", inspectionBody({ result: "Failed", checklist: [{ label: "Slide", status: "Fail", critical: true }] }));
  assert.equal(failed.status, 200, JSON.stringify(failed.body));
  assert.equal(db.tables.firearms[0].condition_status, "Inspection Required");
  assert.equal(db.tables.firearm_status_history.length, 1);
  assert.equal(db.tables.firearm_status_history[0].old_status, "In Service");
  assert.equal(db.tables.firearm_status_history[0].new_status, "Inspection Required");
  assert.match(db.tables.firearm_status_history[0].notes, /^Inspection result Failed \(inspection /);

  const passed = await call(route, "POST", "/api/armory/inspections", inspectionBody());
  assert.equal(passed.status, 200);
  assert.equal(passed.body.updatedFirearmStatus, "In Service");
  assert.equal(db.tables.firearms[0].condition_status, "In Service");
  assert.equal(db.tables.firearm_status_history.length, 2);
  assert.equal(db.tables.firearm_status_history[1].new_status, "In Service");

  // A manual out-of-service is not undone by a later passing inspection.
  db.tables.firearms[0].condition_status = "Out of Service";
  db.tables.firearm_status_history.push({ department_id: D, firearm_id: "fa-1", old_status: "In Service", new_status: "Out of Service", notes: "Sent to manufacturer", changed_at: "2099-01-01T00:00:00Z" });
  db.tables.firearm_status_history.reverse(); // the double ignores order(); latest first
  const passedAgain = await call(route, "POST", "/api/armory/inspections", inspectionBody());
  assert.equal(passedAgain.status, 200);
  assert.equal(passedAgain.body.updatedFirearmStatus, null);
  assert.equal(db.tables.firearms[0].condition_status, "Out of Service");
});

// ARM-33
test("ARM-33: an empty caliber is a validation message, not a database error", async () => {
  const db = world({});
  const result = await call("../../app/api/armory/firearms/[firearmId]/route.ts", "PATCH", "/x", { make: "Glock", model: "17", serialNumber: "SN1", firearmType: "handgun", caliber: "  ", changeNote: "Fix import" }, { firearmId: "fa-1" });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /Caliber is required/);
  assert.equal(db.rpcs.length, 0);

  const ok = await call("../../app/api/armory/firearms/[firearmId]/route.ts", "PATCH", "/x", { make: "Glock", model: "17", serialNumber: "SN1", firearmType: "handgun", caliber: "9mm", changeNote: "Fix import" }, { firearmId: "fa-1" });
  assert.equal(ok.status, 200);
  assert.equal(db.rpcs[0].p_caliber, "9mm");
});

// ARM-26
test("ARM-26: a reviewer cannot decide their own off-duty request; another reviewer can", async () => {
  const route = "../../app/api/off-duty-firearms/[requestId]/route.ts";
  const request = { id: "od-1", department_id: D, officer_user_id: CHIEF, request_status: "Pending Command Review", make: "Glock", model: "43", serial_number: "OD1" };
  let db = world({ off_duty_firearm_requests: [{ ...request }] }, CHIEF, ["review_off_duty_requests", "submit_off_duty_requests"]);
  const own = await call(route, "PATCH", "/x", { action: "Deny", notes: "x" }, { requestId: "od-1" });
  assert.equal(own.status, 403);
  assert.match(own.body.error, /your own off-duty firearm request/);
  assert.equal(db.rpcs.length, 0);

  db = world({ off_duty_firearm_requests: [{ ...request }] }, "user-lieutenant", ["review_off_duty_requests"]);
  const other = await call(route, "PATCH", "/x", { action: "Deny", notes: "Not eligible" }, { requestId: "od-1" });
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.equal(db.rpcs[0].name, "apply_off_duty_firearm_decision");
});

// ARM-28
test("ARM-28: a failed off-duty inspection makes the authorization non-compliant", async () => {
  const request = { id: "od-2", department_id: D, officer_user_id: OFFICER, request_status: "Approved", authorization_status: "Authorized", compliance_status: "Authorized", approval_effective_date: "2026-01-01", approval_expiration_date: "2099-01-01", make: "Glock", model: "43", serial_number: "OD2", submitted_at: "2026-01-01" };
  const db = world({
    off_duty_firearm_requests: [request], off_duty_firearm_history: [], department_rules: [],
    off_duty_firearm_inspections: [{ id: "odi-1", department_id: D, request_id: "od-2", inspection_date: new Date().toISOString().slice(0, 10), result: "Fail", created_at: new Date().toISOString() }],
    profiles: [], department_memberships: [],
  }, ARMORER, ["manage_inspections", "manage_firearms"]);
  const list = await call("../../app/api/off-duty-firearms/route.ts", "GET", "/api/off-duty-firearms");
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const record = (list.body.records ?? list.body.requests ?? []).find((row: Row) => row.id === "od-2");
  assert.equal(record.authorizationStatus, "Authorized");
  assert.equal(record.compliance, "Non-Compliant");

  // The bridge runtime's database function does not store it; the route does.
  db.tables.off_duty_firearm_requests[0].compliance_status = "Authorized";
  const recorded = await call("../../app/api/off-duty-firearms/[requestId]/inspections/route.ts", "POST", "/x", { inspectionDate: "2026-10-20", result: "Fail", notes: "Cracked slide" }, { requestId: "od-2" });
  assert.equal(recorded.status, 200, JSON.stringify(recorded.body));
  assert.equal(db.rpcs[0].name, "record_off_duty_firearm_inspection");
  assert.equal(db.tables.off_duty_firearm_requests[0].compliance_status, "Non-Compliant");
});

// ARM-29
test("ARM-29: an owner cannot review or reinstate their own personal rifle; another reviewer can", async () => {
  const route = "../../app/api/armory/personal-rifles/[rifleId]/route.ts";
  const tables = () => ({
    personal_rifles: [{ id: "pr-1", department_id: D, owner_user_id: CHIEF, status: "Pending Chief Approval" }, { id: "pr-2", department_id: D, owner_user_id: CHIEF, status: "Suspended" }],
    department_rules: [], personal_rifle_status_history: [],
    department_membership_roles: [{ department_id: D, user_id: CHIEF, role_code: "chief" }, { department_id: D, user_id: "user-lieutenant", role_code: "chief" }],
    department_role_permissions: [{ department_id: D, role_code: "chief", permission_code: "approve_personal_rifles" }, { department_id: D, role_code: "chief", permission_code: "manage_inspections" }],
  });
  const reviewer = ["approve_personal_rifles", "manage_inspections"];
  let db = world(tables(), CHIEF, reviewer);
  for (const [rifleId, action] of [["pr-1", "chief_approve"], ["pr-1", "chief_deny"], ["pr-2", "reinstate"]]) {
    const result = await call(route, "PATCH", "/x", { action, notes: "x" }, { rifleId });
    assert.equal(result.status, 403, `${action}: ${JSON.stringify(result.body)}`);
    assert.match(result.body.error, /your own personal rifle/);
  }
  assert.equal(db.tables.personal_rifles[0].status, "Pending Chief Approval");
  assert.equal(db.tables.personal_rifles[1].status, "Suspended");

  db = world(tables(), "user-lieutenant", reviewer);
  const approved = await call(route, "PATCH", "/x", { action: "chief_approve" }, { rifleId: "pr-1" });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(db.tables.personal_rifles[0].chief_reviewed_by, "user-lieutenant");
});

// ARM-21 / ARM-22
const ammoType = { id: "type-1", name: "9mm Duty", caliber: "9mm", category: "Duty", purpose: "", unitLabel: "rounds", currentOnHand: 1000, reorderThreshold: 0, verificationMode: "Manual", customIntervalDays: null, nextVerificationDate: "", notes: "", isActive: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const storedActivity = { id: "act-1", ammoTypeId: "type-1", lotId: null, kind: "Purchase Received", quantityChange: 1000, quantityBefore: 0, quantityAfter: 1000, reference: "", notes: "", unitCost: null, totalCost: null, createdAt: "2026-01-01T00:00:00.000Z", recordedByUserId: "user-original", recordedByName: "Original Clerk" };
const storedWorkspace = () => ({ schemaVersion: 2, ammoTypes: [ammoType], lots: [], activity: [storedActivity], reconciliations: [], settings: { defaultVerificationMode: "Manual", defaultCustomIntervalDays: 180, allowNegativeInventory: false } });
const countSave = (physical: number, notes: string, expected = 1000) => {
  const workspace = storedWorkspace();
  return {
    ...workspace,
    ammoTypes: [{ ...ammoType, currentOnHand: physical }],
    activity: [
      { ...storedActivity, recordedByUserId: "user-forged", recordedByName: "Forged" },
      { id: "act-2", ammoTypeId: "type-1", lotId: null, kind: "Physical Count", quantityChange: physical - expected, quantityBefore: expected, quantityAfter: physical, reference: "Physical inventory", notes, unitCost: null, totalCost: null, createdAt: "2026-10-20T00:00:00.000Z", recordedByUserId: "user-forged" },
    ],
    reconciliations: [{ id: "count-1", ammoTypeId: "type-1", expectedQuantity: expected, physicalQuantity: physical, variance: physical - expected, notes, completedAt: "2026-10-20T00:00:00.000Z" }],
  };
};

test("ARM-21/ARM-22: the server stamps the actor on each new activity and count, and a count variance needs a reason", async () => {
  const route = "../../app/api/pilot/ammunition/route.ts";
  const put = (workspace: unknown) => call(route, "PUT", "/api/pilot/ammunition", { workspace });
  const db = world({ pilot_ammunition_workspaces: [{ department_id: D, workspace: storedWorkspace(), updated_at: "2026-01-01" }], audit_events: [] });

  const unexplained = await put(countSave(800, ""));
  assert.equal(unexplained.status, 400);
  assert.match(unexplained.body.error, /Explain the count variance/);
  assert.equal(db.tables.pilot_ammunition_workspaces[0].workspace.activity.length, 1);

  const stale = await put(countSave(800, "Short", 900));
  assert.equal(stale.status, 409);
  assert.match(stale.body.error, /changed to 1000/);

  const saved = await put(countSave(800, "200 rounds unaccounted for; reported to command"));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const workspace = db.tables.pilot_ammunition_workspaces[0].workspace;
  const [original, count] = workspace.activity;
  assert.equal(original.recordedByUserId, "user-original");
  assert.equal(original.recordedByName, "Original Clerk");
  assert.equal(count.recordedByUserId, ARMORER);
  assert.equal(count.recordedByName, `Name of ${ARMORER}`);
  assert.equal(workspace.reconciliations[0].countedByUserId, ARMORER);
  assert.equal(workspace.reconciliations[0].expectedQuantity, 1000);
  assert.equal(workspace.reconciliations[0].variance, -200);

  const matching = await put({ ...countSave(1000, "", 1000) });
  assert.equal(matching.status, 200, "a count that matches needs no reason");
});

test("C-32: a save based on an older ledger is refused instead of overwriting the newer one", async () => {
  const route = "../../app/api/pilot/ammunition/route.ts";
  const put = (body: unknown) => call(route, "PUT", "/api/pilot/ammunition", body);
  const loadedAt = "2026-10-20T10:00:00.000Z";
  const db = world({ pilot_ammunition_workspaces: [{ department_id: D, workspace: storedWorkspace(), updated_at: loadedAt }], audit_events: [] });
  const purchase = (id: string) => ({ ...storedWorkspace(), activity: [storedActivity, { ...storedActivity, id, quantityBefore: 1000, quantityAfter: 1500, quantityChange: 500, createdAt: "2026-10-20T11:00:00.000Z" }], ammoTypes: [{ ...ammoType, currentOnHand: 1500 }] });

  // Two armorers load the ledger at loadedAt; the first one saves.
  const first = await put({ workspace: purchase("act-a"), baseUpdatedAt: loadedAt });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.updatedAt && first.body.updatedAt !== loadedAt, "the response carries the new revision");

  // The second one saves from the same, now stale, ledger: refused, nothing lost.
  const second = await put({ workspace: purchase("act-b"), baseUpdatedAt: loadedAt });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "stale_workspace");
  assert.match(second.body.error, /changed since you loaded it/);
  assert.deepEqual(db.tables.pilot_ammunition_workspaces[0].workspace.activity.map((entry: Row) => entry.id), ["act-1", "act-a"]);

  // Reloaded, the second save succeeds on top of the first.
  const retried = await put({ workspace: { ...purchase("act-b"), activity: [storedActivity, purchase("act-a").activity[1], purchase("act-b").activity[1]] }, baseUpdatedAt: first.body.updatedAt });
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(db.tables.pilot_ammunition_workspaces[0].workspace.activity.length, 3);
});

// ARM-23
const reconciliationTables = (status = "Draft", submittedBy: string | null = null) => ({
  department_rules: [],
  ammunition_lots: [{ id: "lot-1", department_id: D, category: "Duty", caliber: "9mm", manufacturer: "X", lot_number: "L1", quantity_on_hand: 500, is_active: true }, { id: "lot-foreign", department_id: "dept-2", quantity_on_hand: 10 }],
  ammunition_reconciliations: [{ id: "rec-1", department_id: D, cycle_name: "Spring", cycle_year: 2026, status, created_by: ARMORER, submitted_by: submittedBy }],
  ammunition_reconciliation_items: [{ reconciliation_id: "rec-1", department_id: D, lot_id: "lot-1", expected_quantity: 500, physical_quantity: 480, variance: -20, explanation: "Range issue not logged" }],
});

test("ARM-23: expected quantities come from the lots, a variance needs a reason, and the submitter cannot certify", async () => {
  const route = "../../app/api/armory/ammunition/reconciliations/route.ts";
  const post = (body: unknown) => call(route, "POST", "/api/armory/ammunition/reconciliations", body);

  let db = world(reconciliationTables());
  const forged = await post({ action: "save", reconciliationId: "rec-1", items: [{ lotId: "lot-1", expectedQuantity: 480, physicalQuantity: 480, explanation: "" }] });
  assert.equal(forged.status, 200, JSON.stringify(forged.body));
  assert.equal(db.tables.ammunition_reconciliation_items[0].expected_quantity, 500);
  assert.equal(db.tables.ammunition_reconciliation_items[0].variance, -20);

  const foreign = await post({ action: "save", reconciliationId: "rec-1", items: [{ lotId: "lot-foreign", physicalQuantity: 1 }] });
  assert.equal(foreign.status, 400);

  const unexplained = await post({ action: "submit", reconciliationId: "rec-1", items: [{ lotId: "lot-1", expectedQuantity: 480, physicalQuantity: 480, explanation: "" }] });
  assert.equal(unexplained.status, 400);
  assert.match(unexplained.body.error, /requires an explanation/);
  assert.equal(db.tables.ammunition_reconciliations[0].status, "Draft");

  db = world(reconciliationTables("Submitted", ARMORER));
  const self = await post({ action: "certify", reconciliationId: "rec-1", items: [{ lotId: "lot-1", expectedQuantity: 0, physicalQuantity: 0 }] });
  assert.equal(self.status, 403);
  assert.match(self.body.error, /another person must certify/);
  assert.equal(db.tables.ammunition_reconciliations[0].status, "Submitted");
  assert.equal(db.tables.ammunition_reconciliation_items[0].physical_quantity, 480, "a refused certify rewrites nothing");

  const view = await call(route, "GET", "/api/armory/ammunition/reconciliations");
  assert.equal(view.status, 200, JSON.stringify(view.body));

  db = world(reconciliationTables("Submitted", ARMORER), CHIEF);
  const certified = await post({ action: "certify", reconciliationId: "rec-1", items: [{ lotId: "lot-1", expectedQuantity: 0, physicalQuantity: 0 }] });
  assert.equal(certified.status, 200, JSON.stringify(certified.body));
  assert.equal(db.tables.ammunition_reconciliations[0].status, "Certified");
  assert.equal(db.tables.ammunition_reconciliations[0].certified_by, CHIEF);
  assert.equal(db.tables.ammunition_reconciliation_items[0].physical_quantity, 480, "certify does not rewrite the counts");
});

test("C-R1: Save Draft or a second Submit cannot pull a submitted count back from the certifier; Withdraw is explicit", async () => {
  const route = "../../app/api/armory/ammunition/reconciliations/route.ts";
  const post = (body: unknown) => call(route, "POST", "/api/armory/ammunition/reconciliations", body);
  const counted = [{ lotId: "lot-1", physicalQuantity: 300, explanation: "recount" }];

  let db = world(reconciliationTables("Submitted", ARMORER));
  const draft = await post({ action: "save", reconciliationId: "rec-1", items: counted });
  assert.equal(draft.status, 409);
  assert.match(draft.body.error, /awaiting certification/);
  assert.equal(db.tables.ammunition_reconciliations[0].status, "Submitted");
  assert.equal(db.tables.ammunition_reconciliations[0].submitted_by, ARMORER);
  assert.equal(db.tables.ammunition_reconciliation_items[0].physical_quantity, 480, "the submitted counts are untouched");

  db = world(reconciliationTables("Submitted", ARMORER), CHIEF);
  const resubmit = await post({ action: "submit", reconciliationId: "rec-1", items: counted });
  assert.equal(resubmit.status, 409);
  assert.equal(db.tables.ammunition_reconciliations[0].submitted_by, ARMORER, "a second submit cannot take over the submission");
  assert.equal(db.tables.ammunition_reconciliation_items[0].physical_quantity, 480);

  db = world(reconciliationTables("Submitted", ARMORER));
  const withdrawn = await post({ action: "withdraw", reconciliationId: "rec-1", items: counted });
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
  assert.equal(db.tables.ammunition_reconciliations[0].status, "Draft");
  assert.equal(db.tables.ammunition_reconciliations[0].submitted_by, null);
  assert.equal(db.tables.ammunition_reconciliation_items[0].physical_quantity, 480, "withdrawing changes the status only");

  db = world(reconciliationTables("Draft"));
  assert.equal((await post({ action: "withdraw", reconciliationId: "rec-1" })).status, 409);
  db = world(reconciliationTables("Certified", ARMORER));
  assert.equal((await post({ action: "withdraw", reconciliationId: "rec-1" })).status, 409);
  assert.equal(db.tables.ammunition_reconciliations[0].status, "Certified");
});

// B8a
async function inMode<T>(mode: string | undefined, run: () => Promise<T>) {
  const previous = process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE;
  if (mode === undefined) delete process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE; else process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE = mode;
  try { return await run(); } finally {
    if (previous === undefined) delete process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE; else process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE = previous;
  }
}
const rpcReturns = (db: ReturnType<typeof createDb>, data: unknown, error: Row | null = null) => {
  (db as any).rpc = async (name: string, args: Row) => { db.rpcs.push({ name, ...args }); return { data, error }; };
};

test("B8a ARM-06: if the archive fails, the assignment is not closed as not returned", async () => {
  const db = world({ firearms: [firearm()], firearm_assignments: [openAssignment()] });
  const from = db.from;
  (db as any).from = (table: string) => {
    const builder = from(table);
    if (table !== "firearms") return builder;
    const update = builder.update;
    builder.update = (value: Row) => { update(value); builder.then = (resolve: any) => Promise.resolve({ data: null, error: { message: "archive failed" } }).then(resolve); return builder; };
    return builder;
  };
  const result = await call("../../app/api/armory/firearms/[firearmId]/archive/route.ts", "PATCH", "/x", { archiveReason: "Reported stolen", notReturnedReason: "Stolen" }, { firearmId: "fa-1" });
  assert.equal(result.status, 500);
  assert.equal(db.tables.firearm_assignments[0].returned_at, null);
  assert.equal(db.tables.firearm_assignments[0].condition_at_return, undefined);
});

test("B8a ARM-29: rifle review permission comes from the session, not from department_role_permissions", async () => {
  const route = "../../app/api/armory/personal-rifles/[rifleId]/route.ts";
  // On AWS a non-administrator cannot read the role tables: they come back empty.
  const tables = () => ({ personal_rifles: [{ id: "pr-1", department_id: D, owner_user_id: OFFICER, status: "Pending Chief Approval" }], department_rules: [], personal_rifle_status_history: [], department_membership_roles: [], department_role_permissions: [] });
  let db = world(tables(), CHIEF, ["approve_personal_rifles"]);
  const approved = await call(route, "PATCH", "/x", { action: "chief_approve" }, { rifleId: "pr-1" });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(db.tables.personal_rifles[0].status, "Approved");

  db = world(tables(), "user-other-officer", ["submit_off_duty_requests"]);
  const refused = await call(route, "PATCH", "/x", { action: "chief_approve" }, { rifleId: "pr-1" });
  assert.equal(refused.status, 403);
  assert.equal(db.tables.personal_rifles[0].status, "Pending Chief Approval");

  const list = await call("../../app/api/armory/personal-rifles/route.ts", "GET", "/api/armory/personal-rifles");
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.access.canChiefReview, false);
});

test("B8a ARM-29: on AWS the route leaves rifle history to the database and passes its note; bridge still writes it", async () => {
  const route = "../../app/api/armory/personal-rifles/[rifleId]/route.ts";
  const tables = () => ({ personal_rifles: [{ id: "pr-1", department_id: D, owner_user_id: OFFICER, status: "Approved" }], department_rules: [{ department_id: D, allow_personally_owned_rifles: true, require_personal_rifle_spec_acknowledgment: false }], personal_rifle_status_history: [] as Row[],
    department_membership_roles: [{ department_id: D, user_id: CHIEF, role_code: "chief" }], department_role_permissions: [{ department_id: D, role_code: "chief", permission_code: "approve_personal_rifles" }] });
  const reviewer = ["approve_personal_rifles"];

  let db = world(tables(), CHIEF, reviewer);
  const suspended = await inMode("aws-native", () => call(route, "PATCH", "/x", { action: "suspend", notes: "Qualification lapsed" }, { rifleId: "pr-1" }));
  assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
  assert.equal(db.tables.personal_rifle_status_history.length, 0);
  assert.equal(db.tables.personal_rifles[0].workflow_note, "Qualification lapsed");
  db = world(tables(), OFFICER, []);
  const created = await inMode("aws-native", () => call("../../app/api/armory/personal-rifles/route.ts", "POST", "/x", { manufacturer: "Colt", model: "M4", serialNumber: "PR-NEW", caliber: "5.56", ownershipConfirmed: true }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(db.tables.personal_rifle_status_history.length, 0);

  db = world(tables(), CHIEF, reviewer);
  const bridge = await inMode(undefined, () => call(route, "PATCH", "/x", { action: "suspend", notes: "Qualification lapsed" }, { rifleId: "pr-1" }));
  assert.equal(bridge.status, 200);
  assert.deepEqual(db.tables.personal_rifle_status_history.map((row) => [row.from_status, row.to_status, row.action, row.actor_user_id, row.notes]), [["Approved", "Suspended", "Approval Suspended", CHIEF, "Qualification lapsed"]]);
  assert.equal("workflow_note" in db.tables.personal_rifles[0], false);
});

test("B8a ARM-11/17: on AWS a firearm status change and its history row are one database call", async () => {
  const route = "../../app/api/armory/firearms/[firearmId]/status/route.ts";
  let db = world({ firearms: [firearm()], firearm_assignments: [], firearm_status_history: [] });
  rpcReturns(db, true);
  const changed = await inMode("aws-native", () => call(route, "PATCH", "/x", { status: "Out of Service", notes: "Cracked frame" }, { firearmId: "fa-1" }));
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual(db.rpcs, [{ name: "change_firearm_status", p_department_id: D, p_firearm_id: "fa-1", p_from_status: "In Service", p_to_status: "Out of Service", p_notes: "Cracked frame" }]);
  assert.equal(db.tables.firearm_status_history.length, 0);
  assert.equal(db.writes.filter((write) => write.table === "firearms").length, 0);

  db = world({ firearms: [firearm()], firearm_assignments: [], firearm_status_history: [] });
  rpcReturns(db, false);
  const stale = await inMode("aws-native", () => call(route, "PATCH", "/x", { status: "Out of Service" }, { firearmId: "fa-1" }));
  assert.equal(stale.status, 409);
});

test("B8a off-duty: on AWS an inspection manager who cannot read the request records the inspection; missing and forbidden are 404 and 403", async () => {
  const route = "../../app/api/off-duty-firearms/[requestId]/inspections/route.ts";
  const inspector = ["manage_inspections"];
  // RLS hides the request from an inspection manager without review permission.
  let db = world({ off_duty_firearm_requests: [] }, ARMORER, inspector);
  rpcReturns(db, { id: "odi-1" });
  const recorded = await inMode("aws-native", () => call(route, "POST", "/x", { inspectionDate: "2026-10-20", result: "Pass" }, { requestId: "od-9" }));
  assert.equal(recorded.status, 200, JSON.stringify(recorded.body));
  assert.equal(db.rpcs[0].name, "record_off_duty_firearm_inspection");
  assert.equal(db.rpcs[0].p_request_id, "od-9");

  db = world({ off_duty_firearm_requests: [] }, ARMORER, inspector);
  rpcReturns(db, null, { message: "PostgreSQL data operation failed.", code: "P0002" });
  const missing = await inMode("aws-native", () => call(route, "POST", "/x", { inspectionDate: "2026-10-20", result: "Pass" }, { requestId: "od-missing" }));
  assert.equal(missing.status, 404);

  rpcReturns(db, null, { message: "PostgreSQL data operation failed.", code: "42501" });
  const forbidden = await inMode("aws-native", () => call(route, "POST", "/x", { inspectionDate: "2026-10-20", result: "Pass" }, { requestId: "od-9" }));
  assert.equal(forbidden.status, 403);

  db = world({ off_duty_firearm_requests: [] }, OFFICER, ["submit_off_duty_requests"]);
  const officer = await inMode("aws-native", () => call(route, "POST", "/x", { inspectionDate: "2026-10-20", result: "Pass" }, { requestId: "od-9" }));
  assert.equal(officer.status, 403);
  assert.equal(db.rpcs.length, 0);

  db = world({ off_duty_firearm_requests: [] }, ARMORER, inspector);
  const bridge = await inMode(undefined, () => call(route, "POST", "/x", { inspectionDate: "2026-10-20", result: "Pass" }, { requestId: "od-9" }));
  assert.equal(bridge.status, 404);
});

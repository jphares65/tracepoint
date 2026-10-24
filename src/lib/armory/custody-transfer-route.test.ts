/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// SV-28 handler-level test: the real custody route runs against an in-memory
// data client; only the session resolver and server-only marker are replaced.
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__custodyAccess,
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  permissionDeniedResponse: (message: string) => Response.json({ error: message }, { status: 403 }),
  hasAnyServerPermission: (context: any, permissions: string[]) => context.permissions.includes("administer_department") || permissions.some((permission) => context.permissions.includes(permission)),
});

const department = "10000000-0000-4000-8000-000000000001";
const officer = "20000000-0000-4000-8000-000000000001";
const custodian = "20000000-0000-4000-8000-000000000002";
const firearm = "30000000-0000-4000-8000-000000000001";
const location = "50000000-0000-4000-8000-000000000001";
const key = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function createDb(tables: Record<string, any[]>, failure?: { code: string; message: string }) {
  const rpcs: any[] = [];
  const from = (table: string) => {
    const filters: ((row: any) => boolean)[] = [];
    const rows = () => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    const builder: any = {
      select: () => builder,
      eq: (column: string, value: any) => { filters.push((row) => String(row[column]) === String(value)); return builder; },
      is: (column: string, value: any) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
      order: () => builder,
      in: (column: string, values: any[]) => { filters.push((row) => values.includes(row[column])); return builder; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: any) => resolve({ data: rows(), error: null }),
    };
    return builder;
  };
  // Simulates 028 transfer_firearm_custody's state change and event.
  const rpc = async (name: string, args: any) => {
    // 070 firearm_in_active_department: the custody GET's agency-scoped existence check (not a write, so not recorded).
    if (name === "firearm_in_active_department") return { data: (tables.firearms ?? []).some((row: any) => row.id === args.p_firearm_id && row.department_id === department), error: null };
    rpcs.push({ name, args });
    if (failure) return { data: null, error: failure };
    const existing = tables.firearm_current_custody[0];
    const action_type = existing ? "TRANSFER" : "INITIALIZE";
    const next = { department_id: department, firearm_id: args.p_firearm_id, holder_type: args.p_to_holder_type, holder_user_id: args.p_to_holder_user_id, storage_location_id: args.p_to_storage_location_id };
    if (existing) Object.assign(existing, next); else tables.firearm_current_custody.push(next);
    tables.firearm_custody_events.unshift({ id: `event-${rpcs.length}`, department_id: department, firearm_id: args.p_firearm_id, action_type, reason: args.p_reason, notes: args.p_notes, to_holder_type: args.p_to_holder_type, occurred_at: new Date().toISOString() });
    return { data: `event-${rpcs.length}`, error: null };
  };
  return { db: { from, rpc }, rpcs };
}

const unrestricted = (): Record<string, any[]> => ({
  firearms: [{ id: firearm, department_id: department }],
  firearm_assignments: [{ department_id: department, firearm_id: firearm, assigned_to_user_id: officer, returned_at: null }],
  firearm_current_custody: [{ department_id: department, firearm_id: firearm, holder_type: "OFFICER", holder_user_id: officer }],
  firearm_custody_events: [],
  firearm_possession_restrictions: [],
  department_memberships: [{ department_id: department, user_id: officer, is_active: true }, { department_id: department, user_id: custodian, is_active: true }],
  profiles: [{ id: officer, full_name: "Olive Officer" }, { id: custodian, full_name: "Casey Custodian" }],
});

async function harness(tables: Record<string, any[]>, permissions: string[], userId = custodian, failure?: { code: string; message: string }) {
  const { GET, POST } = await import("../../app/api/armory/firearms/[firearmId]/custody/route.ts");
  const { custodyPageActions } = await import("./custody-transfer.ts");
  const { db, rpcs } = createDb(tables, failure);
  (globalThis as any).__custodyAccess = { ok: true, context: { db, admin: db, departmentId: department, userId, permissions } };
  const params = { params: Promise.resolve({ firearmId: firearm }) };
  const getResponse = () => GET(new Request("http://x") as any, params);
  const get = async () => (await getResponse()).json();
  const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as any, params);
  return { get, getResponse, post, rpcs, custodyPageActions };
}

test("SV-28 reproduction and fix: an authorized custodian transfers an unrestricted firearm in both directions", async () => {
  const { custodyTransferRequest } = await import("./custody-transfer.ts");
  const tables = unrestricted();
  const { get, post, rpcs, custodyPageActions } = await harness(tables, ["firearm_custody.check_in", "firearm_custody.check_out", "firearm_custody.view_history"]);

  const before = await get();
  // The UX-RB page offered only the restricted operation, which is unavailable
  // for an unrestricted firearm — so no custody action was shown (the defect).
  assert.equal(before.operations.canCheckIn, false);
  assert.equal(before.operations.canCheckOut, false);
  // SV-28: the ordinary transfer is exposed and chosen by the page.
  assert.deepEqual(before.operations.transfer, { canCheckIn: true, canCheckOut: false, checkOutToUserId: officer, canCheckOutTemporary: true, recipients: [{ userId: custodian, name: "Casey Custodian", badgeNumber: null }] }, "the officer holding it is not offered as a recipient");
  assert.deepEqual(custodyPageActions(before.operations), { checkIn: "transfer", checkOut: null });

  const checkIn = await post(custodyTransferRequest({ direction: "CHECK_IN", storageLocationId: location, reason: "End of shift", notes: "Locker 4", idempotencyKey: key(1) }));
  assert.equal(checkIn.status, 200);
  assert.deepEqual(rpcs[0], { name: "transfer_firearm_custody", args: { p_firearm_id: firearm, p_to_holder_type: "SECURE_STORAGE", p_to_holder_user_id: null, p_to_storage_location_id: location, p_reason: "End of shift", p_notes: "Locker 4", p_idempotency_key: key(1), p_administrative_correction: false } });

  const stored = await get();
  assert.deepEqual(custodyPageActions(stored.operations), { checkIn: null, checkOut: "transfer" });

  const checkOut = await post(custodyTransferRequest({ direction: "CHECK_OUT", toHolderUserId: stored.operations.transfer.checkOutToUserId, reason: "Start of shift", idempotencyKey: key(2) }));
  assert.equal(checkOut.status, 200);
  assert.deepEqual(rpcs[1].args, { p_firearm_id: firearm, p_to_holder_type: "OFFICER", p_to_holder_user_id: officer, p_to_storage_location_id: null, p_reason: "Start of shift", p_notes: null, p_idempotency_key: key(2), p_administrative_correction: false });

  const after = await get();
  assert.deepEqual(custodyPageActions(after.operations), { checkIn: "transfer", checkOut: null });
  assert.deepEqual(after.events.map((event: any) => [event.reason, event.notes]), [["Start of shift", null], ["End of shift", "Locker 4"]]);
});

test("SV-28: the staging page's pre-031 body is now accepted for a custodian with check-in permission", async () => {
  const { post, rpcs } = await harness(unrestricted(), ["firearm_custody.check_in"]);
  const response = await post({ toHolderType: "SECURE_STORAGE", toHolderUserId: null, toStorageLocationId: location, reason: "End of shift", notes: null, idempotencyKey: key(3), administrativeCorrection: false });
  assert.equal(response.status, 200);
  assert.equal(rpcs[0].name, "transfer_firearm_custody");
  assert.equal(rpcs[0].args.p_administrative_correction, false);
});

test("SV-28: each direction needs its own permission; refused before the database", async () => {
  const { post, rpcs } = await harness(unrestricted(), ["firearm_custody.check_in"]);
  const response = await post({ toHolderType: "OFFICER", toHolderUserId: officer, reason: "Issue", idempotencyKey: key(4) });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /check-out permission/);
  assert.equal(rpcs.length, 0);
  // manage_firearms is accepted by 028 for both directions.
  const manager = await harness(unrestricted(), ["manage_firearms"]);
  assert.equal((await manager.post({ toHolderType: "OFFICER", toHolderUserId: officer, reason: "Issue", idempotencyKey: key(5) })).status, 200);
});

test("SV-28: administrative corrections stay disabled, even with the override permission", async () => {
  const { post, rpcs } = await harness(unrestricted(), ["firearm_custody.check_in", "firearm_custody.check_out", "firearm_custody.override", "manage_firearms"]);
  const response = await post({ toHolderType: "SECURE_STORAGE", toStorageLocationId: location, reason: "Fix record", idempotencyKey: key(6), administrativeCorrection: true });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Administrative custody corrections are not available.", code: "administrative_correction_unavailable" });
  assert.equal(rpcs.length, 0);
});

test("SV-28: malformed and ambiguous bodies are 400 with a message, before the database", async () => {
  const { post, rpcs } = await harness(unrestricted(), ["manage_firearms"]);
  for (const body of [{}, null, [], { action: "CHECK_IN", toHolderType: "SECURE_STORAGE" }, { toHolderType: "SECURE_STORAGE", reason: "x", idempotencyKey: key(7) }, { toHolderType: "OFFICER", toHolderUserId: officer, idempotencyKey: key(8) }]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.ok((await response.json()).error);
  }
  assert.equal(rpcs.length, 0);
});

test("SV-28: database refusals are returned as clear 4xx messages", async () => {
  const noCarry = await harness(unrestricted(), ["firearm_custody.check_out"], custodian, { code: "42501", message: "active possession restriction prohibits checkout" });
  const refused = await noCarry.post({ toHolderType: "OFFICER", toHolderUserId: officer, reason: "Issue", idempotencyKey: key(9) });
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { error: "This firearm is restricted No Carry and cannot be checked out to an officer." });
  const inactive = await harness(unrestricted(), ["firearm_custody.check_in"], custodian, { code: "22023", message: "storage location unavailable" });
  const bad = await inactive.post({ toHolderType: "SECURE_STORAGE", toStorageLocationId: location, reason: "x", idempotencyKey: key(10) });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "Choose an active secure-storage location." });
});

test("SV-28: a custodian who holds only a transfer permission can read current custody, not history", async () => {
  const tables = unrestricted();
  tables.firearm_custody_events.push({ id: "e", department_id: department, firearm_id: firearm, action_type: "TRANSFER", reason: "x", to_holder_type: "OFFICER" });
  const { get, getResponse } = await harness(tables, ["firearm_custody.check_in"]);
  assert.equal((await getResponse()).status, 200);
  const body = await get();
  assert.deepEqual(body.events, []);
  assert.equal(body.operations.transfer.canCheckIn, true);
  // Without any custody permission or assignment, GET stays refused.
  const stranger = await harness(unrestricted(), []);
  assert.equal((await stranger.getResponse()).status, 403);
});

test("SV-28: on a Duty Only firearm the page prefers the restricted operation, and falls back to the ordinary transfer", async () => {
  const dutyOnly = () => {
    const tables = unrestricted();
    tables.firearm_current_custody[0] = { department_id: department, firearm_id: firearm, holder_type: "SECURE_STORAGE", holder_user_id: null, storage_location_id: location };
    tables.firearm_possession_restrictions.push({ department_id: department, firearm_id: firearm, is_active: true, restriction_type: "duty_only", duty_only: true, no_possession_permitted: false, effective_start: "2026-01-01T00:00:00Z", expires_at: null });
    return tables;
  };
  // The assignee, without custody permissions: restricted check-out (031).
  const assignee = await harness(dutyOnly(), [], officer);
  assert.deepEqual(assignee.custodyPageActions((await assignee.get()).operations), { checkIn: null, checkOut: "restricted" });
  // A custodian with check-out but no restricted-custody permission: the ordinary
  // transfer, to the assigned officer only (the same holder 031 would set).
  const custodianOps = (await (await harness(dutyOnly(), ["firearm_custody.check_out", "firearm_custody.view_history"])).get()).operations;
  assert.deepEqual(custodianOps.transfer, { canCheckIn: false, canCheckOut: true, checkOutToUserId: officer, canCheckOutTemporary: false, recipients: [] }, "no temporary custody under Duty Only");
  assert.equal(custodianOps.canCheckOut, false);
});

test("SV-28: a No Carry firearm can be checked in but not checked out by the ordinary transfer", async () => {
  const tables = unrestricted();
  tables.firearm_possession_restrictions.push({ department_id: department, firearm_id: firearm, is_active: true, restriction_type: "no_carry", duty_only: false, no_possession_permitted: true, effective_start: "2026-01-01T00:00:00Z", expires_at: null });
  const { get } = await harness(tables, ["firearm_custody.check_in", "firearm_custody.check_out", "firearm_custody.view_history"]);
  assert.deepEqual((await get()).operations.transfer, { canCheckIn: true, canCheckOut: false, checkOutToUserId: officer, canCheckOutTemporary: false, recipients: [] }, "no temporary custody under No Carry");
});

test("SV-31: GET says whether the caller may manage storage locations (the permission 034 checks)", async () => {
  const manager = await harness(unrestricted(), ["firearm_custody.view_history", "firearm_custody.manage_storage_locations"]);
  assert.equal((await manager.get()).operations.canManageStorageLocations, true);
  const viewer = await harness(unrestricted(), ["firearm_custody.view_history", "manage_firearms"]);
  assert.equal((await viewer.get()).operations.canManageStorageLocations, false);
  const admin = await harness(unrestricted(), ["administer_department"]);
  assert.equal((await admin.get()).operations.canManageStorageLocations, true);
});

test("Owner item 2/3: temporary custody goes only to an active member of this agency, and the assignment is not touched", async () => {
  const { custodyTransferRequest } = await import("./custody-transfer.ts");
  const outsider = "20000000-0000-4000-8000-000000000009";
  const inactive = "20000000-0000-4000-8000-000000000004";
  const tables = unrestricted();
  tables.department_memberships.push({ department_id: department, user_id: inactive, is_active: false }, { department_id: "10000000-0000-4000-8000-000000000002", user_id: outsider, is_active: true });
  const { get, post, rpcs } = await harness(tables, ["firearm_custody.check_out", "firearm_custody.check_in"]);
  const offered = (await get()).operations.transfer.recipients.map((recipient: any) => recipient.userId);
  assert.deepEqual(offered, [custodian], "only active members of this agency, not the current holder");
  for (const recipient of [outsider, inactive]) {
    const refused = await post(custodyTransferRequest({ direction: "CHECK_OUT", toHolderUserId: recipient, reason: "Temporary", idempotencyKey: crypto.randomUUID() }));
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error, "The selected officer is not an active member of this agency.");
  }
  assert.equal(rpcs.length, 0, "refused before the database");
  const accepted = await post(custodyTransferRequest({ direction: "CHECK_OUT", toHolderUserId: custodian, reason: "Loaner", idempotencyKey: key(30) }));
  assert.equal(accepted.status, 200);
  assert.equal(rpcs[0].args.p_administrative_correction, false);
  assert.deepEqual(tables.firearm_assignments, [{ department_id: department, firearm_id: firearm, assigned_to_user_id: officer, returned_at: null }]);
});

test("Owner item 1: storage-location management uses the database's permission on every layer", async () => {
  const { readFile } = await import("node:fs/promises");
  const [route, panel, link] = await Promise.all([
    readFile("src/app/api/armory/storage-locations/route.ts", "utf8"),
    readFile("src/app/settings/components/SecureStorageLocationsPanel.tsx", "utf8"),
    readFile("src/lib/armory/storage-location-link.ts", "utf8"),
  ]);
  assert.doesNotMatch(route, /manage_firearms/);
  assert.equal(route.match(/hasAnyServerPermission\(resolved\.context, \["firearm_custody\.manage_storage_locations"\]\)/g)?.length, 3, "create, update, deactivate");
  assert.match(panel, /const canManage = hasPermission\(STORAGE_LOCATION_MANAGEMENT_PERMISSION\);/);
  assert.doesNotMatch(panel, /manage_firearms/);
  assert.match(link, /STORAGE_LOCATION_MANAGEMENT_PERMISSION: TracePointPermission = "firearm_custody\.manage_storage_locations"/);
  const sql = (await readFile("database/aws/028_firearm_custody_phase_a.sql", "utf8")) + (await readFile("database/aws/034_firearm_storage_location_management.sql", "utf8"));
  for (const name of ["create_firearm_storage_location", "update_firearm_storage_location", "deactivate_firearm_storage_location"]) {
    const start = sql.lastIndexOf(`create or replace function public.${name}(`);
    assert.ok(start >= 0, name);
    const body = sql.slice(start, sql.indexOf("end $$", start));
    assert.match(body, /has_department_permission\(v_department_id, 'firearm_custody\.manage_storage_locations'\)/, name);
    assert.doesNotMatch(body, /manage_firearms/, name);
  }
});

test("Owner item 2: the page offers temporary custody explicitly and says the assignment does not change", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile("src/app/firearms/[firearmId]/page.tsx", "utf8");
  assert.match(page, />Temporary Custody to an Officer<\/button>/);
  assert.match(page, /The assignment stays with/);
  assert.match(page, /toHolderUserId: transferDestination === "TEMPORARY" \? temporaryRecipientId : checkOutToUserId/);
});

test("API-2: custody of an unknown firearm, or of another agency's, is not found (404) and returns no custody", async () => {
  for (const firearms of [[], [{ id: firearm, department_id: "10000000-0000-4000-8000-0000000000ff" }]]) {
    const tables = { ...unrestricted(), firearms };
    const { getResponse } = await harness(tables, ["firearm_custody.view_history", "manage_firearms"]);
    const response = await getResponse();
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Firearm not found." });
  }
  const { getResponse } = await harness(unrestricted(), ["firearm_custody.view_history"]);
  assert.equal((await getResponse()).status, 200, "the agency's own firearm still answers");
});

test("custody-only roles keep the custody card: view_history reads history; a restriction manager sees custody and restrictions, not history", async () => {
  const tables = unrestricted();
  tables.firearm_custody_events.push({ id: "event-0", department_id: department, firearm_id: firearm, action_type: "INITIALIZE", reason: "issue", occurred_at: "2026-10-24T00:00:00Z" });
  const viewer = await harness(tables, ["firearm_custody.view_history"]);
  const viewed = await viewer.getResponse();
  assert.equal(viewed.status, 200, "view_history alone is not refused by the existence check");
  assert.equal((await viewed.json()).events.length, 1);
  const manager = await harness(tables, ["manage_firearm_restrictions"]);
  const managed = await manager.getResponse();
  assert.equal(managed.status, 200);
  const body = await managed.json();
  assert.deepEqual(body.events, [], "history follows 028's policy: view_history or manage_firearms");
  assert.equal(body.current.holder_user_id, officer);
  const outsider = await harness({ ...tables, firearms: [] }, []);
  assert.equal((await outsider.getResponse()).status, 403, "a caller with no custody access is refused before the existence check");
});

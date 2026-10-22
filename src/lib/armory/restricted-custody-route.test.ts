/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// UX-RB-4 handler-level test: the real custody route runs against an in-memory
// data client; only the session resolver and server-only marker are replaced.
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__custodyAccess,
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  permissionDeniedResponse: (message: string) => Response.json({ error: message }, { status: 403 }),
  hasAnyServerPermission: (context: any, permissions: string[]) => permissions.some((permission) => context.permissions.includes(permission)),
});

const department = "10000000-0000-4000-8000-000000000001";
const officer = "20000000-0000-4000-8000-000000000001";
const firearm = "30000000-0000-4000-8000-000000000001";
const location = "50000000-0000-4000-8000-000000000001";

function createDb(tables: Record<string, any[]>) {
  const rpcs: any[] = [];
  const from = (table: string) => {
    const filters: ((row: any) => boolean)[] = [];
    const rows = () => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    const builder: any = {
      select: () => builder,
      eq: (column: string, value: any) => { filters.push((row) => String(row[column]) === String(value)); return builder; },
      is: (column: string, value: any) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
      order: () => builder,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: any) => resolve({ data: rows(), error: null }),
    };
    return builder;
  };
  // Simulates 031's state change so both directions can be driven through the route.
  const rpc = async (name: string, args: any) => {
    rpcs.push({ name, args });
    const current = tables.firearm_current_custody[0];
    current.holder_type = args.p_action === "CHECK_IN" ? "SECURE_STORAGE" : "OFFICER";
    current.holder_user_id = args.p_action === "CHECK_IN" ? null : officer;
    tables.firearm_custody_events.unshift({ id: `event-${rpcs.length}`, department_id: current.department_id, firearm_id: args.p_firearm_id, action_type: "TRANSFER", reason: args.p_action, notes: args.p_notes, to_holder_type: current.holder_type, occurred_at: new Date().toISOString() });
    return { data: `event-${rpcs.length}`, error: null };
  };
  return { db: { from, rpc }, rpcs };
}

test("UX-RB-4: transfers in both directions through the real route with the page's requests", async () => {
  const { restrictedCustodyRequest } = await import("./restricted-custody.ts");
  const { GET, POST } = await import("../../app/api/armory/firearms/[firearmId]/custody/route.ts");
  const tables: Record<string, any[]> = {
    firearm_assignments: [{ department_id: department, firearm_id: firearm, assigned_to_user_id: officer, returned_at: null }],
    firearm_current_custody: [{ department_id: department, firearm_id: firearm, holder_type: "OFFICER", holder_user_id: officer }],
    firearm_custody_events: [],
    firearm_possession_restrictions: [{ department_id: department, firearm_id: firearm, is_active: true, restriction_type: "duty_only", duty_only: true, no_possession_permitted: false, effective_start: "2026-01-01T00:00:00Z", expires_at: null }],
  };
  const { db, rpcs } = createDb(tables);
  (globalThis as any).__custodyAccess = { ok: true, context: { db, departmentId: department, userId: officer, permissions: [] } };
  const params = { params: Promise.resolve({ firearmId: firearm }) };
  const get = async () => (await GET(new Request("http://x") as any, params)).json();
  const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as any, params);

  assert.deepEqual((await get()).operations, { canCheckIn: true, canCheckOut: false });

  const checkIn = await post(restrictedCustodyRequest({ action: "CHECK_IN", storageLocationId: location, reason: "End of shift", notes: "Locker 4", idempotencyKey: "60000000-0000-4000-8000-000000000001" }));
  assert.equal(checkIn.status, 200);
  assert.deepEqual(rpcs[0], { name: "operate_restricted_firearm_custody", args: { p_firearm_id: firearm, p_action: "CHECK_IN", p_storage_location_id: location, p_notes: "End of shift — Locker 4", p_idempotency_key: "60000000-0000-4000-8000-000000000001" } });
  assert.deepEqual((await get()).operations, { canCheckIn: false, canCheckOut: true });

  const checkOut = await post(restrictedCustodyRequest({ action: "CHECK_OUT", reason: "Start of shift", idempotencyKey: "60000000-0000-4000-8000-000000000002" }));
  assert.equal(checkOut.status, 200);
  assert.equal(rpcs[1].args.p_action, "CHECK_OUT");
  assert.equal(rpcs[1].args.p_storage_location_id, null);
  assert.deepEqual((await get()).operations, { canCheckIn: true, canCheckOut: false });
  // History is shown to history-permission holders (2c7bc51), e.g. a supervisor.
  (globalThis as any).__custodyAccess = { ok: true, context: { db, departmentId: department, userId: "20000000-0000-4000-8000-000000000002", permissions: ["firearm_custody.view_history"] } };
  const history = await get();
  assert.deepEqual(history.events.map((event: any) => event.notes), ["Start of shift", "End of shift — Locker 4"]);
  assert.deepEqual(history.operations, { canCheckIn: false, canCheckOut: false });
});

test("UX-RB-4: the RC record page's body is refused before reaching the database", async () => {
  const { POST } = await import("../../app/api/armory/firearms/[firearmId]/custody/route.ts");
  const { db, rpcs } = createDb({ firearm_current_custody: [{}], firearm_custody_events: [] });
  (globalThis as any).__custodyAccess = { ok: true, context: { db, departmentId: department, userId: officer, permissions: [] } };
  const response = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ toHolderType: "SECURE_STORAGE", toStorageLocationId: location, reason: "End of shift", idempotencyKey: "60000000-0000-4000-8000-000000000003", administrativeCorrection: false }) }) as any, { params: Promise.resolve({ firearmId: firearm }) });
  assert.equal(response.status, 400);
  assert.equal(rpcs.length, 0);
});

test("UX-RB-4: another officer without custody permission sees no operations", async () => {
  const { GET } = await import("../../app/api/armory/firearms/[firearmId]/custody/route.ts");
  const tables: Record<string, any[]> = {
    firearm_assignments: [{ department_id: department, firearm_id: firearm, assigned_to_user_id: officer, returned_at: null }],
    firearm_current_custody: [{ department_id: department, firearm_id: firearm, holder_type: "OFFICER", holder_user_id: officer }],
    firearm_custody_events: [],
    firearm_possession_restrictions: [{ department_id: department, firearm_id: firearm, is_active: true, restriction_type: "duty_only", duty_only: true, effective_start: "2026-01-01T00:00:00Z" }],
  };
  const { db } = createDb(tables);
  (globalThis as any).__custodyAccess = { ok: true, context: { db, departmentId: department, userId: "20000000-0000-4000-8000-000000000099", permissions: ["firearm_custody.view_history"] } };
  const body = await (await GET(new Request("http://x") as any, { params: Promise.resolve({ firearmId: firearm }) })).json();
  assert.deepEqual(body.operations, { canCheckIn: false, canCheckOut: false });
});

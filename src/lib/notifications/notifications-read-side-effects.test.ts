/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// SV-32 part 2: does loading My Home (GET /api/notifications) enqueue or send
// email, and can repeated or concurrent loads (login, departmentId re-render,
// a second tab, Notifications page) produce duplicate side effects?
//
// The real GET and PATCH handlers, reconciliation and event writer run against
// an in-memory data client that models the two production unique indexes the
// writes rely on:
//   notification_events_user_key_uidx      (department_id,user_id,notification_key)
//   notification_email_queue_fingerprint_uidx (department_id,user_id,notification_key,fingerprint)
// Every query yields to the event loop, so concurrent handlers interleave.
// Only the session resolver, the source collectors and the server-only marker
// are replaced (route modules load as CommonJS under tsx).
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };

const DEPARTMENT = "d0000000-0000-4000-8000-000000000001";
const USER = "a0000000-0000-4000-8000-000000000001";
type Row = Record<string, any>;
type Hook = (table: string, op: string, payload: any) => Promise<void> | void;

const state: { tables: Record<string, Row[]>; fleet: Row[]; hook: Hook | null; writes: { table: string; op: string }[] } = {
  tables: {}, fleet: [], hook: null, writes: [],
};
const UNIQUE: Record<string, string[]> = {
  notification_events: ["department_id", "user_id", "notification_key"],
  notification_email_queue: ["department_id", "user_id", "notification_key", "fingerprint"],
};
let sequence = 0;

function from(table: string) {
  const filters: ((row: Row) => boolean)[] = [];
  let op = "select"; let payload: any = null; let options: any = {}; let single = false;
  const builder: any = {
    select() { return builder; },
    eq(column: string, value: any) { filters.push((row) => String(row[column]) === String(value)); return builder; },
    in(column: string, values: any[]) { filters.push((row) => values.map(String).includes(String(row[column]))); return builder; },
    is(column: string, value: any) { filters.push((row) => (row[column] ?? null) === value); return builder; },
    lte(column: string, value: any) { filters.push((row) => String(row[column]) <= String(value)); return builder; },
    order() { return builder; },
    limit() { return builder; },
    maybeSingle() { single = true; return builder; },
    upsert(value: any, upsertOptions: any) { op = "upsert"; payload = value; options = upsertOptions ?? {}; return builder; },
    update(value: any) { op = "update"; payload = value; return builder; },
    then(resolve: any, reject: any) { return run().then(resolve, reject); },
  };
  async function run() {
    await new Promise((resolve) => setImmediate(resolve));
    if (op !== "select") { state.writes.push({ table, op }); if (state.hook) await state.hook(table, op, payload); }
    const rows = (state.tables[table] ??= []);
    if (op === "select") {
      const matched = rows.filter((row) => filters.every((filter) => filter(row))).map((row) => ({ ...row }));
      return { data: single ? matched[0] ?? null : matched, error: null };
    }
    if (op === "update") {
      for (const row of rows) if (filters.every((filter) => filter(row))) Object.assign(row, payload);
      return { data: null, error: null };
    }
    const key = UNIQUE[table];
    assert.ok(key, `unexpected upsert into ${table}`);
    assert.deepEqual(String(options.onConflict).split(","), key, `${table} upsert must target its unique index`);
    for (const value of Array.isArray(payload) ? payload : [payload]) {
      const existing = rows.find((row) => key.every((column) => String(row[column]) === String(value[column])));
      if (existing) { if (!options.ignoreDuplicates) Object.assign(existing, value); }
      else rows.push({ id: `${table}-${++sequence}`, ...(table === "notification_events" ? { acknowledged_at: null, snoozed_until: null, resolved_at: null } : {}), ...value });
    }
    return { data: null, error: null };
  }
  return builder;
}

const context = {
  admin: { from },
  departmentId: DEPARTMENT,
  user: { id: USER, email: "officer@agency.example" },
  userId: USER,
  permissions: [] as string[],
  enabledFeatures: [] as string[],
  isSupportMode: false,
};

stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => ({ ok: true, context }),
  hasAnyServerPermission: (access: any, permissions: string[]) => permissions.some((permission) => access.permissions.includes(permission)),
});
stub(require.resolve("../tracepoint/fleet-notifications.ts"), { collectFleetNotifications: async () => state.fleet.map((item) => ({ ...item })) });
stub(require.resolve("../tracepoint/agency-training-notifications.ts"), { collectAgencyTrainingNotifications: async () => [] });

// Internal source endpoints are unavailable in this double; the route treats
// them as source errors and still reconciles the Fleet source it can read.
const fetched: string[] = [];
globalThis.fetch = (async (input: any) => { fetched.push(String(input)); return Response.json({ error: "source unavailable in test" }, { status: 503 }); }) as typeof fetch;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const route = require("../../app/api/notifications/route.ts");

const get = async () => {
  const response: Response = await route.GET(new Request("https://staging.tracepointhq.com/api/notifications", { headers: { cookie: "session=x" } }));
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
const patch = async (action: string, notificationId: string) => {
  const response: Response = await route.PATCH(new Request("https://staging.tracepointhq.com/api/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, notificationId }) }));
  assert.equal(response.status, 200, await response.clone().text());
};

const critical = { key: `fleet-equipment-${USER}-eq-1`, source: "Fleet", kind: "fleet_required_equipment_unavailable", title: "Unit 12: Rifle rack Missing", detail: "Critical vehicle equipment requires immediate action.", href: "/fleet-management/v-1?tab=equipment", priority: "Critical", createdAt: null };
const high = { key: `fleet-service-hours-${USER}-v-2`, source: "Fleet", kind: "fleet_service_hours_due", title: "Unit 14 Service Hours Reached", detail: "1,200 hours recorded; service target was 1,000.", href: "/fleet-management/v-2", priority: "High", createdAt: null };

function reset(items: Row[]) {
  state.tables = { notification_events: [], notification_email_queue: [], notification_preferences: [] };
  state.fleet = items; state.hook = null; state.writes = []; fetched.length = 0;
}
const queue = () => state.tables.notification_email_queue;
const events = () => state.tables.notification_events;

test("a My Home load enqueues at most one email per notification version and never dispatches or sends", async () => {
  reset([critical, high]);
  const payload = await get();
  assert.equal(payload.items.length, 2);
  // Default preferences are critical-only: one queue row for the Critical item.
  assert.equal(queue().length, 1);
  assert.equal(queue()[0].notification_key, critical.key);
  assert.equal(queue()[0].status, "Pending");
  assert.equal(queue()[0].fingerprint, events().find((row) => row.notification_key === critical.key)!.fingerprint);
  // The read never calls the dispatcher or loads an email provider.
  assert.equal(fetched.some((url) => url.includes("email-dispatch")), false);
  assert.equal(Object.keys(require.cache).some((path) => /[\\/]lib[\\/]email[\\/]/.test(path)), false);
  assert.equal(state.writes.some((write) => write.table === "notification_email_queue" && write.op === "update"), false);
});

test("repeated loads (sign-in, re-render, navigation back to My Home) do not enqueue duplicates", async () => {
  reset([critical, high]);
  for (let index = 0; index < 6; index += 1) await get();
  assert.equal(queue().length, 1);
  assert.equal(events().length, 2);
  assert.equal(events().every((row) => row.resolved_at === null), true);
});

test("concurrent loads (two tabs, the departmentId re-fetch, Notifications page) do not enqueue duplicates", async () => {
  reset([critical, high]);
  await Promise.all(Array.from({ length: 5 }, () => get()));
  assert.equal(queue().length, 1);
  assert.equal(events().length, 2);
});

test("an acknowledgement made while a My Home load is in flight is not reverted by that load", async () => {
  reset([critical, high]);
  await get();
  const event = events().find((row) => row.notification_key === high.key)!;
  let raced = false;
  // The second load has already read the stored events (unacknowledged) when
  // the officer acknowledges the item; its reconciliation write lands after.
  state.hook = async (table, op) => {
    if (raced || table !== "notification_events" || op !== "upsert") return;
    raced = true; state.hook = null;
    await patch("acknowledge", event.id);
  };
  await get();
  assert.equal(raced, true);
  assert.notEqual(events().find((row) => row.id === event.id)!.acknowledged_at, null);
  // Snooze is preserved the same way.
  const criticalEvent = events().find((row) => row.notification_key === critical.key)!;
  raced = false;
  state.hook = async (table, op) => {
    if (raced || table !== "notification_events" || op !== "upsert") return;
    raced = true; state.hook = null;
    await patch("snooze", criticalEvent.id);
  };
  await get();
  assert.notEqual(events().find((row) => row.id === criticalEvent.id)!.snoozed_until, null);
  assert.equal(queue().length, 1);
});

test("a genuinely changed condition still reopens the item and queues exactly one new email", async () => {
  reset([critical]);
  await get();
  const event = events()[0];
  await patch("acknowledge", event.id);
  state.fleet = [{ ...critical, title: "Unit 12: Rifle rack Out of Service" }];
  await Promise.all([get(), get(), get()]);
  assert.equal(events().length, 1);
  assert.equal(events()[0].acknowledged_at, null);
  assert.equal(queue().length, 2);
  assert.equal(new Set(queue().map((row) => row.fingerprint)).size, 2);
  // Unchanged afterwards: no further rows.
  await get();
  assert.equal(queue().length, 2);
});

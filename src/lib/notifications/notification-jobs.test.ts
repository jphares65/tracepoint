/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client and pool doubles */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { afterEach, mock } from "node:test";

// B6 notification delivery. The proxy, dispatch route and generation route
// run unchanged; only the session resolver, the PostgreSQL pool, the
// subject-bound access resolver, the email provider and the server-only
// marker are replaced with in-memory doubles.
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
const state = globalThis as any;
stub(require.resolve("server-only"), {});
stub(require.resolve("../authentication/request-session.ts"), { resolveAuthenticatedPrincipal: async () => null });
stub(require.resolve("../tracepoint/server-access-postgres.ts"), {
  resolvePostgresPlatformLanding: async () => ({ isPlatformAdmin: false, hasActiveDepartmentMembership: true }),
  resolvePostgresAccess: async (principal: any, departmentId: string) => state.__access(principal.userId, departmentId),
});
stub(require.resolve("../tracepoint/server-access.ts"), {
  hasAnyServerPermission: (context: any, codes: string[]) => codes.some((code) => context.permissions.includes(code)),
});
stub(require.resolve("../database/postgres-pool.ts"), { getPostgresPool: () => state.__pool });
// The dispatcher loads its queue client dynamically; the bridge client is the
// Supabase service-role client, replaced here at the driver.
stub(require.resolve("@supabase/supabase-js"), { createClient: () => state.__db });
stub(require.resolve("../email/provider.ts"), {
  EmailProviderConfigurationError: class extends Error {},
  createEmailProvider: () => ({ async send(message: any) { state.__sent.push(message); return { messageId: `m-${state.__sent.length}` }; } }),
});

const SECRET = "s".repeat(40);
const D1 = "d1000000-0000-4000-8000-000000000001", D2 = "d2000000-0000-4000-8000-000000000002";
const NEVER_LOGGED_IN = "a1000000-0000-4000-8000-000000000001", CURRENT = "a1000000-0000-4000-8000-000000000002";
const MANAGER = "a1000000-0000-4000-8000-000000000003", OTHER_TENANT = "b2000000-0000-4000-8000-000000000001";
const environment = { ...process.env };
afterEach(() => { process.env = { ...environment }; mock.timers.reset(); });

type Row = Record<string, any>;
function createDb(tables: Record<string, Row[]>) {
  let sequence = 0;
  function from(table: string) {
    tables[table] ??= [];
    const filters: ((row: Row) => boolean)[] = [];
    let op = "select"; let payload: any = null; let single = false; let options: any = {}; let maximum = Infinity;
    const builder: any = {
      select() { return builder; },
      eq(column: string, value: any) { if (!column.includes(".")) filters.push((row) => String(row[column]) === String(value)); return builder; },
      neq(column: string, value: any) { filters.push((row) => row[column] !== value); return builder; },
      lte(column: string, value: any) { filters.push((row) => String(row[column]) <= String(value)); return builder; },
      in(column: string, values: any[]) { filters.push((row) => values.map(String).includes(String(row[column]))); return builder; },
      is(column: string, value: any) { filters.push((row) => (row[column] ?? null) === value); return builder; },
      not() { return builder; },
      order() { return builder; },
      limit(value: number) { maximum = value; return builder; },
      maybeSingle() { single = true; return builder; },
      update(value: any) { op = "update"; payload = value; return builder; },
      upsert(value: any, upsertOptions: any = {}) { op = "upsert"; payload = value; options = upsertOptions; return builder; },
      then(resolve: any, reject: any) { return Promise.resolve(run()).then(resolve, reject); },
    };
    function run() {
      const rows = tables[table];
      if (op === "upsert") {
        const keys = String(options.onConflict ?? "id").split(",");
        for (const value of Array.isArray(payload) ? payload : [payload]) {
          const existing = rows.find((row) => keys.every((key) => row[key] !== undefined && String(row[key]) === String(value[key])));
          if (existing && !options.ignoreDuplicates) Object.assign(existing, value);
          else if (!existing) rows.push({ id: `${table}-${++sequence}`, ...value });
        }
        return { data: null, error: null };
      }
      const matched = rows.filter((row) => filters.every((filter) => filter(row))).slice(0, maximum);
      if (op === "update") { for (const row of matched) Object.assign(row, payload); return { data: matched.map((row) => ({ ...row })), error: null }; }
      if (single) return { data: matched[0] ? { ...matched[0] } : null, error: null };
      return { data: matched.map((row) => ({ ...row })), error: null };
    }
    return builder;
  }
  return { from, tables };
}

const post = async (route: any, url: string, authorization: string | null, body?: unknown) => {
  const { NextRequest } = await import("next/server");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization !== null) headers.authorization = authorization;
  return route.POST(new NextRequest(`http://localhost${url}`, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }));
};

test("job secret comparison is exact and fails closed without a configured secret", async () => {
  const { authorizedNotificationJob } = await import("./job-authorization.ts");
  assert.equal(authorizedNotificationJob(`Bearer ${SECRET}`, { NOTIFICATION_DISPATCH_SECRET: SECRET }), true);
  assert.equal(authorizedNotificationJob(`Bearer ${SECRET}`, { CRON_SECRET: SECRET }), true);
  for (const header of [null, "", SECRET, `Bearer ${SECRET} `, `Bearer ${SECRET.slice(1)}`, `bearer ${SECRET}`]) {
    assert.equal(authorizedNotificationJob(header, { NOTIFICATION_DISPATCH_SECRET: SECRET }), false, String(header));
  }
  assert.equal(authorizedNotificationJob("Bearer ", {}), false);
  assert.equal(authorizedNotificationJob("Bearer undefined", {}), false);
  assert.match(readFileSync(new URL("./job-authorization.ts", import.meta.url), "utf8"), /timingSafeEqual/);
});

test("AWS-native proxy passes bearer-only job calls to the route and still protects every other API (TRN-08)", async () => {
  const { NextRequest } = await import("next/server");
  const { updateAwsNativeSession } = await import("../authentication/request-proxy.ts");
  const call = (path: string) => updateAwsNativeSession(new NextRequest(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }), async () => null);
  for (const path of ["/api/notifications/email-dispatch", "/api/notifications/generate"]) {
    const response = await call(path);
    assert.equal(response.headers.get("x-middleware-next"), "1", `${path} reaches its route`);
  }
  for (const path of ["/api/notifications", "/api/notifications/preferences", "/api/internal/rehearsal-tenant-negative", "/api/notifications/email-dispatch/x"]) {
    assert.equal((await call(path)).status, 401, `${path} still requires a session`);
  }
});

function queueRow(id: string, userId: string, departmentId = D1) {
  return { id, department_id: departmentId, user_id: userId, recipient_email: `${userId}@example.test`, notification_key: `k-${id}`, fingerprint: `f-${id}`, status: "Pending", scheduled_for: "2026-01-01T00:00:00.000Z", attempt_count: 0 };
}
function dispatchFixture() {
  return createDb({
    department_memberships: [{ department_id: D1, user_id: NEVER_LOGGED_IN, is_active: true }, { department_id: D1, user_id: CURRENT, is_active: false }],
    notification_events: [
      { department_id: D1, user_id: NEVER_LOGGED_IN, notification_key: "k-q1", fingerprint: "f-q1", title: "CPR Expired", detail: "d", href: "/", priority: "Critical", source: "Training" },
      { department_id: D1, user_id: CURRENT, notification_key: "k-q2", fingerprint: "f-q2", title: "CPR Expired", detail: "d", href: "/", priority: "Critical", source: "Training" },
    ],
    notification_email_queue: [queueRow("q1", NEVER_LOGGED_IN), queueRow("q2", CURRENT)],
  });
}

test("dispatcher requires the secret and skips recipients deactivated after queueing (TRN-16)", async () => {
  const route = await import("../../app/api/notifications/email-dispatch/route.ts");
  Object.assign(process.env, { NOTIFICATION_DISPATCH_SECRET: SECRET, NEXT_PUBLIC_SUPABASE_URL: "http://supabase.invalid", SUPABASE_SECRET_KEY: "synthetic", BREVO_API_KEY: "synthetic" });
  delete process.env.TRACEPOINT_DATA_PROVIDER;
  for (const authorization of [null, "Bearer wrong", `Bearer ${SECRET}x`]) {
    state.__db = dispatchFixture(); state.__sent = [];
    const response = await post(route, "/api/notifications/email-dispatch", authorization);
    assert.equal(response.status, 401);
    assert.deepEqual(state.__db.tables.notification_email_queue.map((row: Row) => row.status), ["Pending", "Pending"]);
  }
  state.__db = dispatchFixture(); state.__sent = [];
  const response = await post(route, "/api/notifications/email-dispatch", `Bearer ${SECRET}`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(state.__sent.map((message: any) => message.to[0].email), [`${NEVER_LOGGED_IN}@example.test`]);
  const status = Object.fromEntries(state.__db.tables.notification_email_queue.map((row: Row) => [row.id, row.status]));
  assert.deepEqual(status, { q1: "Sent", q2: "Cancelled" });
  assert.equal(body.cancelledItems, 1);
});

test("AWS-native recipient check asks the server-only membership function; bridge reads active memberships", async () => {
  const { notificationRecipientCheck } = await import("./dispatch-recipient.ts");
  const checks: unknown[][] = [];
  const pool = { async query(sql: string, values: unknown[]) {
    assert.equal(sql, "select tracepoint_auth.notification_recipient_active($1::uuid,$2::uuid) as active");
    checks.push(values);
    return { rows: [{ active: values[1] === NEVER_LOGGED_IN }] } as any;
  } };
  const native = notificationRecipientCheck(pool as never, { from() { throw new Error("no table access"); } });
  assert.deepEqual([await native(D1, NEVER_LOGGED_IN), await native(D1, CURRENT)], [true, false]);
  assert.deepEqual(checks, [[D1, NEVER_LOGGED_IN], [D1, CURRENT]]);
  const bridge = notificationRecipientCheck(null, dispatchFixture());
  assert.deepEqual([await bridge(D1, NEVER_LOGGED_IN), await bridge(D1, CURRENT), await bridge(D2, NEVER_LOGGED_IN)], [true, false, false]);
  await assert.rejects(notificationRecipientCheck(null, { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: "down" } }) }) }) }) }) }) })(D1, CURRENT), /down/);
});

// Two agencies. NEVER_LOGGED_IN has an expired required certification and has
// never opened the app; MANAGER manages a fleet unit with an overdue
// registration (FLT-05). OTHER_TENANT is in agency D2 with an expiring one.
function generationFixture() {
  const member = (department_id: string, user_id: string) => ({ department_id, user_id, is_active: true, rank_title: "Officer", unit_name: null, badge_number: null });
  return createDb({
    department_memberships: [member(D1, NEVER_LOGGED_IN), member(D1, CURRENT), member(D1, MANAGER), member(D2, OTHER_TENANT)],
    profiles: [{ id: NEVER_LOGGED_IN, full_name: "Never Logged In" }, { id: CURRENT, full_name: "Current" }, { id: MANAGER, full_name: "Fleet Manager" }, { id: OTHER_TENANT, full_name: "Other Agency" }],
    certification_types: [D1, D2].map((department_id) => ({ id: `cpr-${department_id}`, department_id, name: "CPR", category: "Medical", expiration_required: true, default_due_soon_days: 30, is_active: true })),
    department_certification_requirements: [D1, D2].map((department_id) => ({ department_id, certification_type_id: `cpr-${department_id}`, is_required: true, is_active: true })),
    training_certifications: [
      // The AWS-native driver returns DATE columns as Date objects.
      { id: "c1", department_id: D1, user_id: NEVER_LOGGED_IN, certification_type_id: `cpr-${D1}`, issue_date: new Date(2024, 9, 1), expiration_date: new Date(2026, 9, 10), is_active: true },
      { id: "c2", department_id: D1, user_id: CURRENT, certification_type_id: `cpr-${D1}`, issue_date: new Date(2026, 0, 1), expiration_date: new Date(2028, 0, 1), is_active: true },
      { id: "c3", department_id: D1, user_id: MANAGER, certification_type_id: `cpr-${D1}`, issue_date: "2026-01-01", expiration_date: "2028-01-01", is_active: true },
      { id: "c4", department_id: D2, user_id: OTHER_TENANT, certification_type_id: `cpr-${D2}`, issue_date: "2024-11-01", expiration_date: "2026-11-05", is_active: true },
    ],
    // A stored in_app_enabled=false no longer suppresses and resolves everything (TRN-35).
    notification_preferences: [{ department_id: D1, user_id: NEVER_LOGGED_IN, in_app_enabled: false, email_enabled: true, critical_email_only: true, digest_mode: "Daily", source_preferences: {} }],
    fleet_rules: [{ department_id: D1 }],
    fleet_vehicles: [{ id: "v1", department_id: D1, unit_number: "101", status: "Available", registration_expiration_date: "2026-10-01" }],
    fleet_work_orders: [], fleet_vehicle_equipment: [], qualification_results: [], notification_events: [], notification_email_queue: [],
    agency_training_requirements: [], agency_training_requirement_members: [], agency_training_attendees: [],
  });
}

function generationEnvironment(targets: { departmentId: string; userId: string }[]) {
  process.env.NOTIFICATION_DISPATCH_SECRET = SECRET;
  process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE = "aws-native";
  process.env.TRACEPOINT_DATA_PROVIDER = "postgres";
  const db = generationFixture();
  const calls = { lock: 0, unlock: 0, released: 0, listings: [] as unknown[][], accessed: [] as string[] };
  let locked = false;
  const query = async (sql: string, values: unknown[] = []) => {
    if (/pg_try_advisory_lock/.test(sql)) { calls.lock += 1; const acquired = !locked; locked = true; return { rows: [{ acquired }] }; }
    if (/pg_advisory_unlock/.test(sql)) { calls.unlock += 1; locked = false; return { rows: [{ pg_advisory_unlock: true }] }; }
    if (/list_notification_generation_targets/.test(sql)) {
      calls.listings.push(values);
      const [departmentId, afterDepartment, afterUser, limit] = values as [string | null, string | null, string | null, number];
      const rows = targets.filter((target) => (!departmentId || target.departmentId === departmentId) && (!afterDepartment || `${target.departmentId}|${target.userId}` > `${afterDepartment}|${afterUser}`));
      return { rows: rows.slice(0, limit).map((target) => ({ department_id: target.departmentId, user_id: target.userId })) };
    }
    if (/enqueue_notification_email/.test(sql)) {
      const [department_id, user_id, recipient_email, notification_key, fingerprint, subject, body_text, scheduled_for, status] = values as string[];
      const queue = db.tables.notification_email_queue;
      if (!db.tables.notification_events.some((event) => event.department_id === department_id && event.user_id === user_id && event.notification_key === notification_key && event.fingerprint === fingerprint)) return { rows: [{ accepted: false }] };
      if (!queue.some((row) => row.department_id === department_id && row.user_id === user_id && row.notification_key === notification_key && row.fingerprint === fingerprint)) {
        queue.push({ id: `q${queue.length + 1}`, department_id, user_id, recipient_email, notification_key, fingerprint, subject, body_text, scheduled_for, status });
      }
      return { rows: [{ accepted: true }] };
    }
    throw new Error(`unexpected SQL ${sql}`);
  };
  state.__pool = { query, connect: async () => ({ query, release: () => { calls.released += 1; } }) };
  state.__access = (userId: string, departmentId: string) => {
    calls.accessed.push(`${departmentId}|${userId}`);
    const membership = db.tables.department_memberships.find((row) => row.user_id === userId && row.department_id === departmentId && row.is_active);
    if (!membership) return { ok: false, status: 403, error: "No active department membership was found." };
    const manager = userId === MANAGER;
    return { ok: true, context: {
      user: { id: userId, email: `${userId}@example.test` }, userId, email: `${userId}@example.test`, admin: db, db, authDb: db,
      departmentId, permissions: manager ? ["manage_fleet"] : [], roleCodes: manager ? ["fleet_manager"] : ["officer"], enabledFeatures: [], isSuperAdmin: false, isSupportMode: false,
    } };
  };
  return { db, calls };
}

const allTargets = [
  { departmentId: D1, userId: NEVER_LOGGED_IN }, { departmentId: D1, userId: CURRENT },
  { departmentId: D1, userId: MANAGER }, { departmentId: D2, userId: OTHER_TENANT },
];

test("generation route requires the secret and the AWS-native runtime", async () => {
  const route = await import("../../app/api/notifications/generate/route.ts");
  const { db, calls } = generationEnvironment(allTargets);
  for (const authorization of [null, "Bearer wrong", SECRET]) {
    assert.equal((await post(route, "/api/notifications/generate", authorization, {})).status, 401);
  }
  delete process.env.NOTIFICATION_DISPATCH_SECRET;
  assert.equal((await post(route, "/api/notifications/generate", "Bearer undefined", {})).status, 401);
  process.env.NOTIFICATION_DISPATCH_SECRET = SECRET;
  process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE = "bridge";
  assert.equal((await post(route, "/api/notifications/generate", `Bearer ${SECRET}`, {})).status, 503);
  process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE = "aws-native";
  assert.equal((await post(route, "/api/notifications/generate", `Bearer ${SECRET}`, { limit: 1000 })).status, 400);
  assert.equal((await post(route, "/api/notifications/generate", `Bearer ${SECRET}`, { departmentId: "x" })).status, 400);
  assert.equal(calls.lock + calls.listings.length + db.tables.notification_events.length, 0);
});

test("generation creates alerts and queued email for members who never signed in, idempotently and per agency (TRN-01, FLT-05)", async () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-20T15:00:00Z") });
  const route = await import("../../app/api/notifications/generate/route.ts");
  const { db, calls } = generationEnvironment(allTargets);
  const run = async (body: unknown) => { const response = await post(route, "/api/notifications/generate", `Bearer ${SECRET}`, body); return { status: response.status, body: await response.json() }; };

  const first = await run({ limit: 3 });
  assert.equal(first.status, 200);
  assert.deepEqual({ attempted: first.body.attempted, generated: first.body.generated, failed: first.body.failed }, { attempted: 3, generated: 3, failed: 0 });
  assert.deepEqual(first.body.nextCursor, { departmentId: D1, userId: MANAGER });
  const second = await run({ limit: 3, after: first.body.nextCursor });
  assert.deepEqual({ attempted: second.body.attempted, nextCursor: second.body.nextCursor }, { attempted: 1, nextCursor: null });
  assert.equal(calls.lock, 2); assert.equal(calls.unlock, 2); assert.equal(calls.released, 2);

  const events = () => db.tables.notification_events.map((row) => `${row.department_id}|${row.user_id}|${row.kind}`).sort();
  assert.deepEqual(events(), [
    `${D1}|${NEVER_LOGGED_IN}|required_certification_expired`,
    `${D1}|${MANAGER}|fleet_registration_due`,
    `${D2}|${OTHER_TENANT}|required_certification_due_soon`,
  ]);
  for (const row of db.tables.notification_events) assert.ok(String(row.notification_key).includes(row.user_id) || row.source === "Fleet", "each member gets only their own alerts");
  // Default preferences email only Critical items: the expired certification and the overdue registration.
  assert.deepEqual(db.tables.notification_email_queue.map((row) => `${row.department_id}|${row.user_id}|${row.recipient_email}`).sort(), [
    `${D1}|${NEVER_LOGGED_IN}|${NEVER_LOGGED_IN}@example.test`,
    `${D1}|${MANAGER}|${MANAGER}@example.test`,
  ]);

  // A second full run changes nothing, including the next day (TRN-10): the
  // snooze the member set survives and no second email is queued.
  const expired = db.tables.notification_events.find((row) => row.user_id === NEVER_LOGGED_IN)!;
  expired.snoozed_until = "2026-10-25T00:00:00.000Z";
  const fingerprint = expired.fingerprint;
  mock.timers.setTime(new Date("2026-10-21T15:00:00Z").getTime());
  await run({}); await run({});
  assert.equal(db.tables.notification_events.length, 3);
  assert.equal(db.tables.notification_email_queue.length, 2);
  assert.equal(expired.fingerprint, fingerprint);
  assert.equal(expired.snoozed_until, "2026-10-25T00:00:00.000Z");
  assert.match(expired.detail, /11 days ago/);

  // Agency scoping: a run for D2 touches only D2 members.
  calls.accessed.length = 0;
  await run({ departmentId: D2 });
  assert.deepEqual(calls.accessed, [`${D2}|${OTHER_TENANT}`]);
});

test("generation skips members whose access no longer resolves and refuses to overlap a running generation", async () => {
  const route = await import("../../app/api/notifications/generate/route.ts");
  const { db, calls } = generationEnvironment(allTargets);
  db.tables.department_memberships.find((row) => row.user_id === NEVER_LOGGED_IN)!.is_active = false;
  const response = await post(route, "/api/notifications/generate", `Bearer ${SECRET}`, { departmentId: D1 });
  const body = await response.json();
  assert.deepEqual({ status: response.status, generated: body.generated, skipped: body.skipped }, { status: 200, generated: 2, skipped: 1 });
  assert.equal(db.tables.notification_events.some((row) => row.user_id === NEVER_LOGGED_IN), false);

  // One member's failure is counted and reported; the rest of the page still runs.
  const resolve = state.__access;
  state.__access = (userId: string, departmentId: string) => { if (userId === CURRENT) throw new Error("PostgreSQL data operation failed."); return resolve(userId, departmentId); };
  const errors = mock.method(console, "error", () => {});
  const partial = await post(route, "/api/notifications/generate", `Bearer ${SECRET}`, { departmentId: D1 });
  const partialBody = await partial.json();
  errors.mock.restore();
  assert.deepEqual({ status: partial.status, ok: partialBody.ok, generated: partialBody.generated, failed: partialBody.failed }, { status: 503, ok: false, generated: 1, failed: 1 });
  assert.match(String(errors.mock.calls[0].arguments[0]), /notification_generation_member_failed.*a1000000-0000-4000-8000-000000000002/);
  state.__access = resolve;

  const pool = state.__pool;
  const held = await pool.connect();
  await held.query("select pg_try_advisory_lock(1)");
  const blocked = await post(route, "/api/notifications/generate", `Bearer ${SECRET}`, {});
  assert.equal(blocked.status, 409);
  assert.equal(calls.listings.length, 2, "the blocked run lists no members");
});

test("inbox views offer Acknowledge only where the API accepts it (TRN-13)", async () => {
  const { CONDITION_BASED_NOTIFICATION_KINDS, notificationCanBeAcknowledged } = await import("./acknowledge-policy.ts");
  for (const kind of ["qualification_failed", "agency_training_overdue", "agency_training_due_soon_staff", "required_certification_expired"]) {
    assert.equal(CONDITION_BASED_NOTIFICATION_KINDS.has(kind), true);
    assert.equal(notificationCanBeAcknowledged(kind), false);
  }
  assert.equal(notificationCanBeAcknowledged("off_duty_firearm_review_required"), true);
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  for (const page of ["../../app/page.tsx", "../../app/notifications/page.tsx"]) {
    const text = source(page);
    assert.match(text, /notificationCanBeAcknowledged\(item\.kind\) \?/, `${page} gates Acknowledge on the API rule`);
    assert.doesNotMatch(text, /"required_certification_missing"/, `${page} keeps no private kind list`);
  }
  assert.match(source("../../app/api/notifications/route.ts"), /import \{ CONDITION_BASED_NOTIFICATION_KINDS \} from "@\/lib\/notifications\/acknowledge-policy"/);
});

test("off-duty notification upserts name the event unique key and reopen the event (TRN-19)", () => {
  for (const path of ["../../app/api/off-duty-firearms/route.ts", "../../app/api/off-duty-firearms/[requestId]/route.ts"]) {
    const text = readFileSync(new URL(path, import.meta.url), "utf8");
    const upserts = [...text.matchAll(/\.from\("notification_events"\)\s*\.upsert\(([\s\S]*?)\);/g)].map((match) => match[1]);
    assert.ok(upserts.length > 0, path);
    for (const call of upserts) assert.match(call, /onConflict: NOTIFICATION_EVENT_KEY/, path);
    assert.match(text, /const NOTIFICATION_EVENT_KEY = "department_id,user_id,notification_key";/);
    assert.equal((text.match(/acknowledged_at: null,\s*snoozed_until: null,/g) ?? []).length, upserts.length, path);
  }
});

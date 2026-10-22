/* eslint-disable @typescript-eslint/no-explicit-any -- route and pg boundary */
// Run by validate-clean-bootstrap (node --import tsx) against its disposable,
// fully migrated PostgreSQL. Owner release blocker (C-R1 follow-up): the real
// reconciliation route handler and the real AWS-native data client
// (row-level security as `authenticated`) under forced concurrency. A third
// connection holds the reconciliation's row lock while requests queue behind
// it, so each race is deterministic:
// 1. a Save Draft queued behind a Submit cannot return the submission to Draft
//    or change its counts (409);
// 2. a second Submit cannot overwrite the first (409);
// 3. Save Draft and Submit on a Submitted record are refused (409);
// 4. withdrawal stays separate: administrator-only, reason required, audited;
// 5. audit history is untouched by every refused request.
// Only session resolution is replaced (as in the route unit tests).
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";

const require = createRequire(__filename);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
const session = new AsyncLocalStorage<any>();
stub(require.resolve("server-only"), {});
stub(require.resolve("../src/lib/tracepoint/server-access.ts"), {
  resolveServerAccess: async () => session.getStore(),
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  permissionDeniedResponse: (message: string) => Response.json({ error: message }, { status: 403 }),
  hasAnyServerPermission: (context: any, permissions: string[]) => permissions.some((permission) => context.permissions.includes(permission)),
  requireServerFeature: () => null,
});

const D = "05800000-0000-4000-8000-00000000000a";
const A1 = "05800000-0000-4000-8000-0000000000a1"; // armorer
const A2 = "05800000-0000-4000-8000-0000000000a2"; // armorer
const ADMIN = "05800000-0000-4000-8000-0000000000c1";
const LOT1 = "05800000-0000-4000-8000-0000000000d1";
const LOT2 = "05800000-0000-4000-8000-0000000000d2";
const R1 = "05800000-0000-4000-8000-0000000000e1";
const R2 = "05800000-0000-4000-8000-0000000000e2";
const ARMORER = ["manage_firearms", "manage_inspections"];
const ADMINISTRATOR = [...ARMORER, "administer_department"];

async function main() {
  const config = JSON.parse(process.env.TRACEPOINT_VALIDATION_DATABASE ?? "{}");
  const { Pool, Client } = require("pg");
  const connection = { host: "127.0.0.1", port: config.port, user: "postgres", password: config.password, database: "postgres" };
  const pool = new Pool({ ...connection, max: 12 });
  const owner = new Client(connection);
  const blocker = new Client(connection);
  await owner.connect();
  await blocker.connect();
  const { PostgresDataClient } = await import("../src/lib/database/postgres-data-client.ts");
  const route = await import("../src/app/api/armory/ammunition/reconciliations/route.ts");
  const { NextRequest } = await import("next/server");

  const post = (userId: string, permissions: string[], body: Record<string, unknown>) => {
    const admin = new PostgresDataClient(pool, userId, D);
    const context = { ok: true, context: { admin, db: admin, departmentId: D, userId, user: { id: userId }, permissions, enabledFeatures: ["ammunition", "firearms"] } };
    const request = new NextRequest("http://localhost/api/armory/ammunition/reconciliations", {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
    });
    return session.run(context, async () => {
      const response = await (route as any).POST(request);
      return { status: response.status as number, body: await response.json() };
    });
  };
  const query = async (sql: string, values: unknown[] = []) => (await owner.query(sql, values)).rows;
  const state = async (id: string) => {
    const [record] = await query("select status, submitted_by::text, notes from public.ammunition_reconciliations where id=$1", [id]);
    const items = await query("select lot_id::text, expected_quantity, physical_quantity, explanation from public.ammunition_reconciliation_items where reconciliation_id=$1 order by lot_id", [id]);
    return { ...record, items };
  };
  const auditHistory = async () => query("select id, action, entity_type, entity_id::text, actor_user_id::text, summary from public.audit_events where department_id=$1 order by id", [D]);
  // The audited writes since a snapshot: earlier rows unchanged, and the new ones summarised.
  const auditedSince = async (before: any[]) => {
    const now = await auditHistory();
    assert.deepEqual(now.slice(0, before.length), before, "earlier audit rows are unchanged");
    return now.slice(before.length).map((row: any) => `${row.entity_type}:${row.action}:${row.actor_user_id}`).sort();
  };
  // One accepted save: the parent update and a delete and insert per lot, all by the winner.
  const oneSave = (actor: string) => [
    `ammunition_reconciliation_items:delete:${actor}`, `ammunition_reconciliation_items:delete:${actor}`,
    `ammunition_reconciliation_items:insert:${actor}`, `ammunition_reconciliation_items:insert:${actor}`,
    `ammunition_reconciliations:update:${actor}`,
  ].sort();
  const waiters = async (count: number) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const [row] = await query("select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and state='active'");
      if (row.n >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`expected ${count} requests waiting on the reconciliation lock`);
  };
  const lock = async (id: string) => { await blocker.query("begin"); await blocker.query("select id from public.ammunition_reconciliations where id=$1 for update", [id]); };
  const release = () => blocker.query("commit");
  const counts = (lot1: number, lot2: number, explanation = "Recount") => [
    { lotId: LOT1, physicalQuantity: lot1, explanation: lot1 === 500 ? null : explanation },
    { lotId: LOT2, physicalQuantity: lot2, explanation: lot2 === 200 ? null : explanation },
  ];

  // Synthetic agency with real role assignments; committed so every connection sees it.
  await query(`insert into auth.users(id,email) values ($1,'rc-a1@example.invalid'),($2,'rc-a2@example.invalid'),($3,'rc-admin@example.invalid')`, [A1, A2, ADMIN]);
  await query("insert into public.profiles(id,full_name) select id,email from auth.users where email like 'rc-%' on conflict(id) do nothing");
  await query("insert into public.departments(id,name,slug) values ($1,'Reconciliation concurrency','local-rc-concurrency')", [D]);
  await query("insert into public.department_memberships(department_id,user_id,is_active) values ($1,$2,true),($1,$3,true),($1,$4,true)", [D, A1, A2, ADMIN]);
  await query("insert into public.department_membership_roles(department_id,user_id,role_code) values ($1,$2,'armorer'),($1,$3,'armorer'),($1,$4,'administrator')", [D, A1, A2, ADMIN]);
  await query(`insert into public.ammunition_lots(id,department_id,category,caliber,manufacturer,lot_number,quantity_on_hand)
    values ($2,$1,'Duty','9mm','Federal','L1',500),($3,$1,'Training','9mm','Federal','L2',200)`, [D, LOT1, LOT2]);
  for (const id of [R1, R2]) {
    await query(`insert into public.ammunition_reconciliations(id,department_id,cycle_name,cycle_year,cycle_start,cycle_end,status,created_by)
      values ($1,$2,$3,2026,'2026-09-01','2026-11-30','Draft',$4)`, [id, D, id === R1 ? "Fall" : "Spring", A1]);
    await query(`insert into public.ammunition_reconciliation_items(reconciliation_id,department_id,lot_id,expected_quantity)
      values ($1,$2,$3,500),($1,$2,$4,200)`, [id, D, LOT1, LOT2]);
  }
  await query("select set_config('tracepoint.subject_id',$1,false)", [A1]);
  const [{ allowed }] = await query("select public.has_department_permission($1, 'manage_firearms') as allowed", [D]);
  assert.equal(allowed, true, "the armorer role grants manage_firearms");
  await query("select set_config('tracepoint.subject_id','',false)");
  let audits = await auditHistory();

  // 1. A Save Draft queued behind a Submit.
  await lock(R1);
  const submit1 = post(A1, ARMORER, { action: "submit", reconciliationId: R1, notes: "Fall count", items: counts(480, 200) });
  await waiters(1);
  const save1 = post(A2, ARMORER, { action: "save", reconciliationId: R1, notes: "draft over it", items: counts(300, 100) });
  await waiters(2);
  await release();
  const [submitted, overwritten] = await Promise.all([submit1, save1]);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(overwritten.status, 409, JSON.stringify(overwritten.body));
  assert.match(overwritten.body.error, /submitted and awaiting certification/);
  let current = await state(R1);
  assert.equal(current.status, "Submitted");
  assert.equal(current.submitted_by, A1);
  assert.equal(current.notes, "Fall count");
  assert.deepEqual(current.items.map((item: any) => [item.physical_quantity, item.expected_quantity]), [[480, 500], [200, 200]], "the submitted counts are intact");
  assert.deepEqual(await auditedSince(audits), oneSave(A1), "only the Submit's writes are in the audit history");
  audits = await auditHistory();
  console.log("ok 1 - a concurrent Save Draft cannot return a submission to Draft or change its counts");

  // 2. Two Submits.
  await lock(R2);
  const first = post(A1, ARMORER, { action: "submit", reconciliationId: R2, items: counts(500, 190) });
  await waiters(1);
  const second = post(A2, ARMORER, { action: "submit", reconciliationId: R2, items: counts(450, 150) });
  await waiters(2);
  await release();
  const [won, lost] = await Promise.all([first, second]);
  assert.equal(won.status, 200, JSON.stringify(won.body));
  assert.equal(lost.status, 409, JSON.stringify(lost.body));
  current = await state(R2);
  assert.equal(current.submitted_by, A1, "the second Submit did not take over the submission");
  assert.deepEqual(current.items.map((item: any) => item.physical_quantity), [500, 190]);
  assert.deepEqual(await auditedSince(audits), oneSave(A1), "only the first Submit's writes are in the audit history");
  audits = await auditHistory();
  console.log("ok 2 - a second concurrent Submit cannot overwrite the first");

  // 3. Sequential attempts on a Submitted record.
  for (const action of ["save", "submit"]) {
    const refused = await post(A2, ARMORER, { action, reconciliationId: R1, items: counts(1, 1) });
    assert.equal(refused.status, 409, `${action}: ${JSON.stringify(refused.body)}`);
  }
  current = await state(R1);
  assert.equal(current.status, "Submitted");
  assert.deepEqual(current.items.map((item: any) => item.physical_quantity), [480, 200]);
  console.log("ok 3 - Save Draft and Submit on a Submitted record return 409 and change nothing");

  assert.deepEqual(await auditedSince(audits), [], "the refused requests wrote nothing to the audit history");

  // 4. Withdrawal is separate, administrator-only, reason-required, audited.
  assert.equal((await post(A2, ARMORER, { action: "withdraw", reconciliationId: R1, reason: "Recount" })).status, 403);
  assert.equal((await post(ADMIN, ADMINISTRATOR, { action: "withdraw", reconciliationId: R1, reason: " " })).status, 400);
  assert.equal((await state(R1)).status, "Submitted");
  const withdrawn = await post(ADMIN, ADMINISTRATOR, { action: "withdraw", reconciliationId: R1, reason: "Lot L1 recount requested" });
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
  current = await state(R1);
  assert.equal(current.status, "Draft");
  assert.deepEqual(current.items.map((item: any) => item.physical_quantity), [480, 200], "withdrawal changes the status only");
  const added = (await auditHistory()).slice(audits.length);
  assert.deepEqual(await auditedSince(audits), [`ammunition_reconciliation:ammunition_reconciliation_withdrawn:${ADMIN}`, `ammunition_reconciliations:update:${ADMIN}`].sort());
  assert.equal(added.find((row: any) => row.action === "ammunition_reconciliation_withdrawn")?.summary, "Lot L1 recount requested");
  const resaved = await post(A2, ARMORER, { action: "save", reconciliationId: R1, items: counts(470, 200) });
  assert.equal(resaved.status, 200, "after a withdrawal the draft can be edited again");
  console.log("ok 4 - withdrawal is separate, administrator-only, reason-required and audited");
  console.log("ok 5 - every refused request leaves the audit history unchanged; accepted ones are audited once");

  await Promise.all([pool.end(), owner.end(), blocker.end()]);
  console.log("Reconciliation concurrency passed.");
}

main().catch((error) => { console.error(error); process.exit(1); });

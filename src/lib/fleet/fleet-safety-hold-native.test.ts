import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";

// database/aws/046 on top of 043: the safety hold clearance guard, the baseline,
// and the inspection audit outbox keeping its defect work order for reconciliation.
const require = createRequire(import.meta.url);
const { default: EmbeddedPostgres } = require("embedded-postgres") as { default: new (input: Record<string, unknown>) => { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; getPgClient(): { connect(): Promise<void>; end(): Promise<void>; query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> } } };

let directory = "";
let database: InstanceType<typeof EmbeddedPostgres>;
let client: ReturnType<InstanceType<typeof EmbeddedPostgres>["getPgClient"]>;

const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const inspector = "20000000-0000-4000-8000-000000000001";
const manager = "20000000-0000-4000-8000-000000000002";
const mechanic = "20000000-0000-4000-8000-000000000003";
const foreignManager = "20000000-0000-4000-8000-000000000004";
const released = "30000000-0000-4000-8000-000000000001";
const openCritical = "30000000-0000-4000-8000-000000000002";
const unrecorded = "30000000-0000-4000-8000-000000000003";
const migration = (file: string) => readFile(`database/aws/${file}`, "utf8");

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-fleet-safety-hold-"));
  database = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-only", port: await localPostgresPort(), persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await database.initialise();
  await database.start();
  client = database.getPgClient();
  await client.connect();
  await client.query(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin; create role tracepoint_runtime nologin;
    create schema tracepoint_auth;
    create function tracepoint_auth.subject_id() returns uuid language sql stable as $$select nullif(current_setting('tracepoint.subject_id',true),'')::uuid$$;
    create function tracepoint_auth.department_id() returns uuid language sql stable as $$select nullif(current_setting('tracepoint.department_id',true),'')::uuid$$;
    create function tracepoint_auth.is_platform_supporting(p_department_id uuid) returns boolean language sql stable as $$select false$$;
    create table public.departments(id uuid primary key);
    create table public.department_memberships(department_id uuid, user_id uuid, is_active boolean, primary key(department_id,user_id));
    create table public.member_permissions(department_id uuid, user_id uuid, permission_code text);
    create function public.is_department_member(p_department_id uuid) returns boolean language sql stable security definer set search_path = public as $$select exists(select 1 from public.department_memberships where department_id=p_department_id and user_id=tracepoint_auth.subject_id() and is_active)$$;
    create function public.has_any_department_permission(p_department_id uuid, p_codes text[]) returns boolean language sql stable security definer set search_path = public as $$select public.is_department_member(p_department_id) and exists(select 1 from public.member_permissions where department_id=p_department_id and user_id=tracepoint_auth.subject_id() and permission_code = any(p_codes))$$;
    create table public.fleet_rules(department_id uuid primary key, status_automation_enabled boolean default true, critical_issue_out_of_service boolean default true);
    create table public.fleet_vehicles(id uuid primary key, department_id uuid not null, status text not null default 'Available', status_reason text, updated_at timestamptz);
    create table public.fleet_vehicle_inspections(id uuid primary key default gen_random_uuid(), department_id uuid not null, vehicle_id uuid not null, critical_defect_count integer not null default 0, inspector_user_id uuid, created_at timestamptz not null default now());
    create table public.fleet_work_orders(id uuid primary key default gen_random_uuid(), department_id uuid not null, vehicle_id uuid not null, record_type text not null, priority text not null default 'Normal', status text not null default 'Open', affects_availability boolean not null default false, created_by_user_id uuid, created_at timestamptz not null default now());
    create table public.audit_events(id bigint generated always as identity primary key, department_id uuid not null, actor_user_id uuid, action text not null, entity_type text not null, entity_id uuid, summary text, details jsonb not null default '{}'::jsonb);
    grant usage on schema tracepoint_auth to authenticated;
    grant select, insert on public.fleet_vehicle_inspections to authenticated;
    grant select, insert on public.fleet_work_orders to authenticated;
    -- Row policies are not modelled: the update grant lets the guard trigger be the only barrier.
    grant select, update on public.fleet_vehicles to authenticated;
  `);
  await client.query("insert into public.departments values ($1),($2)", [A, B]);
  await client.query("insert into public.department_memberships values ($1,$3,true),($1,$4,true),($1,$5,true),($2,$6,true)", [A, B, inspector, manager, mechanic, foreignManager]);
  await client.query("insert into public.member_permissions values ($1,$2,'perform_fleet_inspections'),($1,$3,'manage_fleet'),($1,$4,'manage_fleet_maintenance'),($5,$6,'manage_fleet')", [A, inspector, manager, mechanic, B, foreignManager]);
  await client.query("insert into public.fleet_vehicles(id,department_id,status) values ($1,$4,'Available'),($2,$4,'Out of Service'),($3,$4,'Out of Service')", [released, openCritical, unrecorded, A]);
  await client.query(await migration("043_fleet_inspection_audit_outbox.sql"));
  // Existing history: a completed critical work order (released by the previous rules), an open one, and a critical inspection with no defect work order.
  await client.query("insert into public.fleet_work_orders(department_id,vehicle_id,record_type,priority,status,affects_availability,created_at) values ($1,$2,'Repair','Critical','Completed',true,now() - interval '30 days'),($1,$3,'Repair','Critical','Open',true,now() - interval '2 days')", [A, released, openCritical]);
  await client.query("insert into public.fleet_vehicle_inspections(department_id,vehicle_id,critical_defect_count,inspector_user_id,created_at) values ($1,$2,1,$3,now() - interval '1 day')", [A, unrecorded, inspector]);
});

after(async () => { await client?.end().catch(() => undefined); await database?.stop().catch(() => undefined); await rm(directory, { recursive: true, force: true }).catch(() => undefined); });

async function as(subject: string, department: string, statements: (query: (sql: string, values?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<unknown>) {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('tracepoint.subject_id',$1,true), set_config('tracepoint.department_id',$2,true)", [subject, department]);
    const result = await statements(async (sql, values) => (await client.query(sql, values)).rows);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
const clearance = (vehicleId: string) => client.query("select safety_hold_cleared_at, safety_hold_cleared_by, safety_hold_clearance_reason from public.fleet_vehicles where id=$1", [vehicleId]).then((result) => result.rows[0]);
const clear = (subject: string, department: string, vehicleId: string, clearedBy: string | null, reason: string | null, at = "now()") =>
  as(subject, department, (query) => query(`update public.fleet_vehicles set safety_hold_cleared_at = ${at}, safety_hold_cleared_by = $2, safety_hold_clearance_reason = $3 where id = $1 returning safety_hold_cleared_at`, [vehicleId, clearedBy, reason]));

test("migration 046 is repeatable and baselines only vehicles the previous rules had released, once", async () => {
  const sql = await migration("046_fleet_safety_hold_clearance.sql");
  await client.query(sql);
  const baseline = await clearance(released);
  assert.ok(baseline.safety_hold_cleared_at);
  assert.equal(baseline.safety_hold_cleared_by, null);
  assert.match(String(baseline.safety_hold_clearance_reason), /^Baseline at migration 046/);
  assert.equal((await clearance(openCritical)).safety_hold_cleared_at, null, "an open critical work order is not baselined");
  assert.equal((await clearance(unrecorded)).safety_hold_cleared_at, null, "a critical inspection without its work order is not baselined");
  await client.query("update public.fleet_vehicles set safety_hold_cleared_at = null, safety_hold_clearance_reason = null where id = $1", [released]);
  await client.query(sql);
  assert.equal((await clearance(released)).safety_hold_cleared_at, null, "a repeated application does not clear holds again");
  const trigger = await client.query("select count(*)::int as n from pg_trigger where tgname = 'fleet_vehicles_safety_hold_clearance_guard'");
  assert.equal(trigger.rows[0].n, 1);
});

test("only a fleet manager of the vehicle's agency can clear a safety hold, with a reason, stamped by the database", async () => {
  const denied = { code: "42501" };
  await assert.rejects(clear(inspector, A, unrecorded, inspector, "looks fine"), denied, "inspector");
  await assert.rejects(clear(mechanic, A, unrecorded, mechanic, "repaired"), denied, "mechanic");
  await assert.rejects(clear(foreignManager, B, unrecorded, foreignManager, "other agency"), denied, "another agency's manager");
  await assert.rejects(as(mechanic, A, (query) => query("update public.fleet_vehicles set safety_hold_clearance_reason = 'edited' where id = $1", [released])), denied, "reason-only edit");
  for (const reason of [null, "", "   "]) await assert.rejects(clear(manager, A, unrecorded, manager, reason), { code: "22023" }, `reason ${JSON.stringify(reason)}`);
  await assert.rejects(clear(manager, A, unrecorded, inspector, "forged clearing user"), { code: "22023" });
  assert.equal((await clearance(unrecorded)).safety_hold_cleared_at, null);

  const [row] = (await clear(manager, A, unrecorded, manager, "brakes replaced", "'2099-01-01'")) as Record<string, unknown>[];
  const stamped = new Date(String(row.safety_hold_cleared_at)).getTime();
  assert.ok(Math.abs(stamped - Date.now()) < 60_000, "a client-supplied time is replaced by the database time");
  assert.deepEqual([(await clearance(unrecorded)).safety_hold_cleared_by, (await clearance(unrecorded)).safety_hold_clearance_reason], [manager, "brakes replaced"]);
  // Reversing (a failed audit) restores the hold.
  await clear(manager, A, unrecorded, null, null, "null");
  assert.equal((await clearance(unrecorded)).safety_hold_cleared_at, null);
  // Unchanged clearance columns do not involve the guard.
  await as(mechanic, A, (query) => query("update public.fleet_vehicles set status = 'Out of Service' where id = $1", [unrecorded]));
});

test("reconciliation after an audit outage records the inspection's defect work order", async () => {
  await client.query("alter table public.audit_events add constraint audit_events_outage check (action <> 'fleet_vehicle_inspected') not valid");
  const inspection = String(((await as(inspector, A, (query) => query("insert into public.fleet_vehicle_inspections(department_id,vehicle_id,critical_defect_count,inspector_user_id) values ($1,$2,1,$3) returning id", [A, released, inspector]))) as Record<string, unknown>[])[0].id);
  const workOrder = String(((await as(inspector, A, (query) => query("insert into public.fleet_work_orders(department_id,vehicle_id,record_type,priority,affects_availability,created_by_user_id) values ($1,$2,'Inspection','Critical',true,$3) returning id", [A, released, inspector]))) as Record<string, unknown>[])[0].id);
  const other = String(((await as(manager, A, (query) => query("insert into public.fleet_work_orders(department_id,vehicle_id,record_type,created_by_user_id) values ($1,$2,'Inspection',$3) returning id", [A, released, manager]))) as Record<string, unknown>[])[0].id);

  // A fresh entry its own request has not attempted yet is left to that request.
  const early = (await as(manager, A, (query) => query("select public.deliver_pending_fleet_audit($1) as result", [A]))) as Record<string, unknown>[];
  assert.equal((early[0].result as Record<string, number>).delivered, 0);
  assert.equal((await client.query("select attempts from public.fleet_audit_outbox where inspection_id=$1", [inspection])).rows[0].attempts, 0);

  const deliver = (workOrderId: string) => as(inspector, A, (query) => query("select public.deliver_fleet_audit_outbox($1, jsonb_build_object('work_order_id',$2::text)) as event", [inspection, workOrderId]));
  assert.equal(((await deliver(other)) as Record<string, unknown>[])[0].event, null);
  assert.equal((await client.query("select work_order_id from public.fleet_audit_outbox where inspection_id=$1", [inspection])).rows[0].work_order_id, null, "another user's work order is not linked");
  assert.equal(((await deliver(workOrder)) as Record<string, unknown>[])[0].event, null);
  const pending = await client.query("select work_order_id, delivered_at, attempts, last_error is not null as failed from public.fleet_audit_outbox where inspection_id=$1", [inspection]);
  assert.deepEqual(pending.rows, [{ work_order_id: workOrder, delivered_at: null, attempts: 2, failed: true }]);
  await client.query("alter table public.audit_events drop constraint audit_events_outage");

  const run = (await as(manager, A, (query) => query("select public.deliver_pending_fleet_audit($1) as result", [A]))) as Record<string, unknown>[];
  assert.ok((run[0].result as Record<string, number>).delivered >= 1);
  const events = await client.query("select details->>'work_order_id' as work_order, details->>'reconciled_by_user_id' as reconciled_by from public.audit_events where details->'inspection'->>'id' = $1", [inspection]);
  assert.deepEqual(events.rows, [{ work_order: workOrder, reconciled_by: manager }]);
});

test("an entry never attempted by its request is reconciled after five minutes", async () => {
  const inspection = String(((await as(inspector, A, (query) => query("insert into public.fleet_vehicle_inspections(department_id,vehicle_id,inspector_user_id) values ($1,$2,$3) returning id", [A, released, inspector]))) as Record<string, unknown>[])[0].id);
  await client.query("update public.fleet_audit_outbox set created_at = now() - interval '6 minutes' where inspection_id = $1", [inspection]);
  await as(manager, A, (query) => query("select public.deliver_pending_fleet_audit($1)", [A]));
  assert.ok((await client.query("select delivered_at from public.fleet_audit_outbox where inspection_id=$1", [inspection])).rows[0].delivered_at);
  const privileges = await client.query("select has_function_privilege('authenticated','public.guard_fleet_safety_hold_clearance()','execute') as guard, has_function_privilege('authenticated','public.fleet_audit_outbox_deliver_internal(uuid,uuid)','execute') as internal, has_function_privilege('anon','public.deliver_pending_fleet_audit(uuid)','execute') as anon");
  assert.deepEqual(privileges.rows[0], { guard: false, internal: false, anon: false });
});

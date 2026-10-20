import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";

// database/aws/046 on top of 043: the safety hold clearance guard, the baseline,
// the critical-inspection hold whatever the automation settings, and the
// inspection audit outbox keeping its defect work order for reconciliation.
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
const verified = "30000000-0000-4000-8000-000000000004";
const staleInspection = "30000000-0000-4000-8000-000000000005";
const automationOff = "30000000-0000-4000-8000-000000000006";
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
    create table public.fleet_work_orders(id uuid primary key default gen_random_uuid(), department_id uuid not null, vehicle_id uuid not null, record_type text not null, title text, priority text not null default 'Normal', status text not null default 'Open', affects_availability boolean not null default false, created_by_user_id uuid, created_at timestamptz not null default now());
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
  await client.query("insert into public.fleet_vehicles(id,department_id,status) values ($1,$4,'Available'),($2,$4,'Out of Service'),($3,$4,'Out of Service'),($5,$4,'Available'),($6,$4,'Available'),($7,$4,'Available')", [released, openCritical, unrecorded, A, verified, staleInspection, automationOff]);
  await client.query(await migration("043_fleet_inspection_audit_outbox.sql"));
  // Existing history: a completed critical work order only (released by the previous rules, no evidence of resolution),
  // an open one (with a passing inspection after it), a critical inspection with no defect work order, a completed critical
  // work order verified by a later passing inspection, and a passing inspection older than the critical work order.
  await client.query("insert into public.fleet_work_orders(department_id,vehicle_id,record_type,priority,status,affects_availability,created_at) values ($1,$2,'Repair','Critical','Completed',true,now() - interval '30 days'),($1,$3,'Repair','Critical','Open',true,now() - interval '2 days'),($1,$4,'Repair','Critical','Completed',true,now() - interval '10 days'),($1,$5,'Repair','Normal','Cancelled',true,now() - interval '3 days')", [A, released, openCritical, verified, staleInspection]);
  await client.query("insert into public.fleet_vehicle_inspections(department_id,vehicle_id,critical_defect_count,inspector_user_id,created_at) values ($1,$2,1,$3,now() - interval '1 day'),($1,$4,0,$3,now() - interval '1 day'),($1,$5,1,$3,now() - interval '12 days'),($1,$5,0,$3,now() - interval '5 days'),($1,$6,0,$3,now() - interval '4 days')", [A, unrecorded, inspector, openCritical, verified, staleInspection]);
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

test("migration 046 is repeatable and baselines, once and audited, only vehicles with a later passing inspection", async () => {
  const sql = await migration("046_fleet_safety_hold_clearance.sql");
  await client.query(sql);
  const baseline = await clearance(verified);
  assert.ok(baseline.safety_hold_cleared_at);
  assert.equal(baseline.safety_hold_cleared_by, null);
  assert.match(String(baseline.safety_hold_clearance_reason), /^Baseline at migration 046: an inspection on \d{4}-\d{2}-\d{2} recorded no critical defects after the latest critical condition/);
  assert.equal((await clearance(released)).safety_hold_cleared_at, null, "a completed critical work order alone is not evidence");
  assert.equal((await clearance(openCritical)).safety_hold_cleared_at, null, "an open critical work order is not baselined, even after a passing inspection");
  assert.equal((await clearance(unrecorded)).safety_hold_cleared_at, null, "a critical inspection without a later passing one is not baselined");
  assert.equal((await clearance(staleInspection)).safety_hold_cleared_at, null, "a passing inspection before the critical condition is not evidence");
  const audit = await client.query("select department_id, actor_user_id, action, entity_type, entity_id, summary, details from public.audit_events where details ? 'baseline'");
  assert.equal(audit.rows.length, 1);
  const [row] = audit.rows as Array<Record<string, unknown> & { details: { reason: unknown; hold: { source: string }; evidence: { inspection_id: string } } }>;
  assert.deepEqual([row.department_id, row.actor_user_id, row.action, row.entity_type, row.entity_id], [A, null, "fleet_safety_hold_cleared", "fleet_vehicle", verified]);
  assert.match(String(row.summary), /migration 046 \(system\)/);
  assert.equal(row.details.reason, baseline.safety_hold_clearance_reason);
  assert.equal(row.details.hold.source, "work_order");
  const evidence = await client.query("select id from public.fleet_vehicle_inspections where vehicle_id = $1 and critical_defect_count = 0", [verified]);
  assert.equal(row.details.evidence.inspection_id, evidence.rows[0].id);
  await client.query("update public.fleet_vehicles set safety_hold_cleared_at = null, safety_hold_clearance_reason = null where id = $1", [verified]);
  await client.query(sql);
  assert.equal((await clearance(verified)).safety_hold_cleared_at, null, "a repeated application does not clear holds again");
  assert.equal((await client.query("select count(*)::int as n from public.audit_events where details ? 'baseline'")).rows[0].n, 1, "nor audits again");
  const trigger = await client.query("select count(*)::int as n from pg_trigger where tgname = 'fleet_vehicles_safety_hold_clearance_guard'");
  assert.equal(trigger.rows[0].n, 1);
});

test("a critical inspection takes the vehicle out of service even with the agency's automation disabled", async () => {
  await client.query("insert into public.fleet_rules values ($1,false,false)", [A]);
  try {
    await as(inspector, A, (query) => query("insert into public.fleet_vehicle_inspections(department_id,vehicle_id,critical_defect_count,inspector_user_id) values ($1,$2,0,$3)", [A, automationOff, inspector]));
    assert.equal((await client.query("select status from public.fleet_vehicles where id=$1", [automationOff])).rows[0].status, "Available", "a passing inspection changes nothing");
    await as(inspector, A, (query) => query("insert into public.fleet_vehicle_inspections(department_id,vehicle_id,critical_defect_count,inspector_user_id) values ($1,$2,1,$3)", [A, automationOff, inspector]));
    const vehicle = (await client.query("select status, status_reason from public.fleet_vehicles where id=$1", [automationOff])).rows[0];
    assert.equal(vehicle.status, "Out of Service");
    assert.match(String(vehicle.status_reason), /Critical defect recorded by a vehicle inspection/);
  } finally {
    await client.query("delete from public.fleet_rules where department_id=$1", [A]);
  }
});

test("a fleet manager cannot clear a safety hold while a critical work order is open", async () => {
  await assert.rejects(clear(manager, A, openCritical, manager, "reviewed"), { code: "55000", message: /critical work order is open/ });
  assert.equal((await clearance(openCritical)).safety_hold_cleared_at, null);
  await client.query("update public.fleet_work_orders set status = 'Completed' where vehicle_id = $1", [openCritical]);
  await clear(manager, A, openCritical, manager, "repair verified");
  assert.equal((await clearance(openCritical)).safety_hold_clearance_reason, "repair verified");
  // An open availability-affecting work order also blocks; reversing a clearance (a failed audit) is still allowed.
  await client.query("insert into public.fleet_work_orders(department_id,vehicle_id,record_type,priority,status,affects_availability) values ($1,$2,'Issue','High','In Progress',true)", [A, openCritical]);
  await assert.rejects(clear(manager, A, openCritical, manager, "again", "now() + interval '1 hour'"), { code: "55000" });
  await clear(manager, A, openCritical, null, null, "null");
  assert.equal((await clearance(openCritical)).safety_hold_cleared_at, null);
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

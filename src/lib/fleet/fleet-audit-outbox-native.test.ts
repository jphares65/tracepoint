import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";

const require = createRequire(import.meta.url);
const { default: EmbeddedPostgres } = require("embedded-postgres") as { default: new (input: Record<string, unknown>) => { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; getPgClient(): { connect(): Promise<void>; end(): Promise<void>; query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> } } };

let directory = "";
let database: InstanceType<typeof EmbeddedPostgres>;
let client: ReturnType<InstanceType<typeof EmbeddedPostgres>["getPgClient"]>;

const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const inspector = "20000000-0000-4000-8000-000000000001";
const manager = "20000000-0000-4000-8000-000000000002";
const officer = "20000000-0000-4000-8000-000000000003";
const outsider = "20000000-0000-4000-8000-000000000004";
const nonMember = "20000000-0000-4000-8000-000000000005";
const vehicle = "30000000-0000-4000-8000-000000000001";
const parked = "30000000-0000-4000-8000-000000000002";

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-fleet-audit-outbox-"));
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
    create table public.fleet_work_orders(id uuid primary key default gen_random_uuid(), department_id uuid not null, vehicle_id uuid not null, record_type text not null);
    create table public.audit_events(id bigint generated always as identity primary key, department_id uuid not null, actor_user_id uuid, action text not null, entity_type text not null, entity_id uuid, summary text, details jsonb not null default '{}'::jsonb);
    grant usage on schema tracepoint_auth to authenticated;
    grant select, insert on public.fleet_vehicle_inspections to authenticated;
  `);
  await client.query("insert into public.departments values ($1),($2)", [A, B]);
  await client.query("insert into public.department_memberships values ($1,$3,true),($1,$4,true),($1,$5,true),($2,$6,true)", [A, B, inspector, manager, officer, outsider]);
  await client.query("insert into public.member_permissions values ($1,$2,'perform_fleet_inspections'),($1,$3,'manage_fleet'),($4,$5,'manage_fleet')", [A, inspector, manager, B, outsider]);
  await client.query("insert into public.fleet_vehicles(id,department_id,status) values ($1,$3,'Available'),($2,$3,'Maintenance')", [vehicle, parked, A]);
});

after(async () => { await client?.end().catch(() => undefined); await database?.stop().catch(() => undefined); await rm(directory, { recursive: true, force: true }).catch(() => undefined); });

// Runs statements in one transaction as the application does: role authenticated with the subject and agency set.
async function as(subject: string, department: string, statements: (query: (sql: string, values?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<unknown>, commit = true) {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('tracepoint.subject_id',$1,true), set_config('tracepoint.department_id',$2,true)", [subject, department]);
    const result = await statements(async (sql, values) => (await client.query(sql, values)).rows);
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
const inspect = (query: (sql: string, values?: unknown[]) => Promise<Record<string, unknown>[]>, vehicleId: string, criticalCount: number) =>
  query("insert into public.fleet_vehicle_inspections(department_id,vehicle_id,critical_defect_count,inspector_user_id) values ($1,$2,$3,$4) returning id", [A, vehicleId, criticalCount, inspector]).then((rows) => String(rows[0].id));
const denied = { code: "42501" };

test("migration 043 is repeatable and installs the inspection outbox trigger", async () => {
  const sql = await readFile("database/aws/054_fleet_inspection_audit_outbox.sql", "utf8");
  await client.query(sql);
  await client.query(sql);
  const trigger = await client.query("select tgenabled from pg_trigger where tgname = 'fleet_vehicle_inspections_audit_outbox' and tgrelid = 'public.fleet_vehicle_inspections'::regclass");
  assert.equal(trigger.rows.length, 1);
});

test("the outbox row and the critical out-of-service hold commit or roll back with the inspection", async () => {
  await as(inspector, A, (query) => inspect(query, vehicle, 1), false);
  assert.equal((await client.query("select count(*)::int as n from public.fleet_audit_outbox")).rows[0].n, 0);
  assert.equal((await client.query("select status from public.fleet_vehicles where id=$1", [vehicle])).rows[0].status, "Available");
  const id = await as(inspector, A, (query) => inspect(query, vehicle, 1));
  const queued = await client.query("select department_id, actor_user_id, action, entity_id, delivered_at, details->'inspection'->>'id' as inspection from public.fleet_audit_outbox where inspection_id=$1", [id]);
  assert.deepEqual(queued.rows, [{ department_id: A, actor_user_id: inspector, action: "fleet_vehicle_inspected", entity_id: vehicle, delivered_at: null, inspection: id }]);
  assert.deepEqual((await client.query("select status, status_reason from public.fleet_vehicles where id=$1", [vehicle])).rows[0], { status: "Out of Service", status_reason: "Critical defect recorded by a vehicle inspection; review before returning to service." });
  await as(inspector, A, (query) => inspect(query, parked, 2));
  assert.equal((await client.query("select status from public.fleet_vehicles where id=$1", [parked])).rows[0].status, "Maintenance", "a stricter status is kept");
});

test("subjects cannot write the outbox directly and anon cannot deliver", async () => {
  await assert.rejects(as(inspector, A, (query) => query("update public.fleet_audit_outbox set delivered_at = now()")), denied);
  await assert.rejects(as(inspector, A, (query) => query("insert into public.fleet_audit_outbox(department_id,inspection_id,action,entity_type) values ($1,gen_random_uuid(),'x','y')", [A])), denied);
  const anon = await client.query("select has_function_privilege('anon','public.deliver_fleet_audit_outbox(uuid,jsonb)','execute') as deliver, has_function_privilege('anon','public.deliver_pending_fleet_audit(uuid)','execute') as reconcile, has_function_privilege('authenticated','public.fleet_audit_outbox_deliver_internal(uuid,uuid)','execute') as internal");
  assert.deepEqual(anon.rows[0], { deliver: false, reconcile: false, internal: false });
});

test("delivery is authorized, tenant-bound and idempotent", async () => {
  const id = await as(inspector, A, (query) => inspect(query, vehicle, 0));
  const workOrder = (await client.query("insert into public.fleet_work_orders(department_id,vehicle_id,record_type) values ($1,$2,'Inspection') returning id", [A, vehicle])).rows[0].id;
  const deliver = (subject: string, department: string) => as(subject, department, (query) => query("select public.deliver_fleet_audit_outbox($1, jsonb_build_object('work_order_id',$2::text)) as event", [id, workOrder]));
  await assert.rejects(deliver(outsider, B), denied, "another agency's manager");
  await assert.rejects(deliver(outsider, A), denied, "a subject outside the agency");
  await assert.rejects(deliver(nonMember, A), denied, "a non-member");
  await assert.rejects(deliver(officer, A), denied, "a member who is neither the inspector nor a fleet manager");
  const first = (await deliver(inspector, A)) as Record<string, unknown>[];
  const second = (await deliver(manager, A)) as Record<string, unknown>[];
  assert.ok(first[0].event);
  assert.equal(second[0].event, first[0].event);
  const events = await client.query("select actor_user_id, action, entity_type, details->>'work_order_id' as work_order, details->'inspection'->>'id' as inspection from public.audit_events where details->'inspection'->>'id' = $1", [id]);
  assert.deepEqual(events.rows, [{ actor_user_id: inspector, action: "fleet_vehicle_inspected", entity_type: "fleet_vehicle", work_order: workOrder, inspection: id }]);
});

test("a failed audit write leaves the entry pending, and reconciliation delivers it later", async () => {
  await client.query("alter table public.audit_events add constraint audit_events_outage check (action <> 'fleet_vehicle_inspected') not valid");
  const id = await as(inspector, A, (query) => inspect(query, vehicle, 1));
  const attempt = (await as(inspector, A, (query) => query("select public.deliver_fleet_audit_outbox($1) as event", [id]))) as Record<string, unknown>[];
  assert.equal(attempt[0].event, null);
  const pending = await client.query("select delivered_at, attempts, last_error is not null as failed from public.fleet_audit_outbox where inspection_id=$1", [id]);
  assert.deepEqual(pending.rows, [{ delivered_at: null, attempts: 1, failed: true }]);
  assert.equal((await client.query("select count(*)::int as n from public.fleet_vehicle_inspections where id=$1", [id])).rows[0].n, 1, "inspection kept");
  await client.query("alter table public.audit_events drop constraint audit_events_outage");

  await assert.rejects(as(outsider, A, (query) => query("select public.deliver_pending_fleet_audit($1)", [A])), denied, "a subject outside the agency");
  await assert.rejects(as(outsider, B, (query) => query("select public.deliver_pending_fleet_audit($1)", [A])), denied, "another agency's manager");
  const officerRun = (await as(officer, A, (query) => query("select public.deliver_pending_fleet_audit($1) as result", [A]))) as Record<string, unknown>[];
  assert.deepEqual(officerRun[0].result, { delivered: 0, failed: 0, pending: 0 }, "members only reconcile their own entries");
  const run = (await as(manager, A, (query) => query("select public.deliver_pending_fleet_audit($1) as result", [A]))) as Record<string, unknown>[];
  assert.equal((run[0].result as Record<string, number>).failed, 0);
  assert.equal((run[0].result as Record<string, number>).pending, 0);
  assert.ok((run[0].result as Record<string, number>).delivered >= 1);
  const delivered = await client.query("select o.delivered_at is not null as delivered, e.details->>'reconciled_by_user_id' as reconciled_by from public.fleet_audit_outbox o join public.audit_events e on e.id = o.audit_event_id where o.inspection_id=$1", [id]);
  assert.deepEqual(delivered.rows, [{ delivered: true, reconciled_by: manager }]);
  assert.equal((await client.query("select count(*)::int as n from public.audit_events where details->'inspection'->>'id' = $1", [id])).rows[0].n, 1);
});

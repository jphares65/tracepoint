import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { PostgresDataClient } from "./postgres-data-client.ts";
import { postgresRuntimeTypes } from "./postgres-type-parsers.ts";
import { SupabaseOperationsReadDataSource, type OperationsClient } from "../operations/read-repository-supabase.ts";
import { buildCommandOperationsPresentation } from "../tracepoint/command-operations.ts";
import { DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION } from "../tracepoint/analytics-dashboard-config.ts";
import { TenantBoundAdministrationReadRepository } from "../administration/read-repository-core.ts";
import { SupabaseAdministrationReadDataSource, type Client as AdministrationClient } from "../administration/read-repository-supabase.ts";

// AWS-native reads must hand the web and mobile code the same timestamp values PostgREST did (DC2).
const department = "10000000-0000-4000-8000-000000000001";
const user = "20000000-0000-4000-8000-000000000001";
const eventId = "30000000-0000-4000-8000-000000000001";
const unstaffedEventId = "30000000-0000-4000-8000-000000000002";
const startsAt = new Date(Date.now() + 3 * 86_400_000);
let server: EmbeddedPostgres;
let pool: pg.Pool;
let directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-timestamp-contract-"));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-test-only", port, persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  const databaseName = "postgres";
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "local-test-only", database: databaseName, types: postgresRuntimeTypes, options: "-c timezone=UTC" });
  await pool.query(`
    do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if; end $$;
    create table public.agency_training_events (id uuid primary key, department_id uuid, title text, training_type text, starts_at timestamptz, ends_at timestamptz, status text, location text);
    create table public.agency_training_attendees (id uuid primary key, department_id uuid, event_id uuid, outcome_status text, recorded_at timestamptz);
    create table public.fleet_vehicles (id uuid primary key, department_id uuid, unit_number text, year integer, make text, model text, status text, open_issue_count integer, next_service_date date, inspection_due_date date, registration_expiration_date date);
    create table public.audit_events (id bigint generated always as identity primary key, department_id uuid, action text, created_at timestamptz);
    create table public.audit_log (id uuid primary key default gen_random_uuid(), department_id uuid, action text, created_at timestamptz);
    create table public.pilot_range_workspaces (department_id uuid primary key, workspace jsonb, updated_at timestamptz, updated_by_user_id uuid);
    create table public.local_times (department_id uuid, observed_at timestamp);
    create function public.list_member_joins() returns table(user_id uuid, joined_at timestamptz) language sql stable as $$ select '${user}'::uuid, timestamptz '2026-10-20 20:55:26.123456+00' $$;
    grant usage on schema public to authenticated;
    grant select, update on all tables in schema public to authenticated;
    grant execute on function public.list_member_joins() to authenticated;
  `);
  for (const table of ["agency_training_events", "agency_training_attendees", "fleet_vehicles", "audit_events", "audit_log", "pilot_range_workspaces", "local_times"]) {
    await pool.query(`alter table public.${table} enable row level security`);
    await pool.query(`create policy tenant_access on public.${table} to authenticated using (department_id = current_setting('tracepoint.department_id')::uuid)`);
  }
  await pool.query("insert into public.agency_training_events values($1,$2,'Patrol Rifle Refresher','In-Service',$3,null,'scheduled','Range A'),($4,$2,'Defensive Tactics','In-Service',$5,null,'scheduled','Gym')", [eventId, department, startsAt.toISOString(), unstaffedEventId, new Date(startsAt.getTime() + 86_400_000).toISOString()]);
  await pool.query("insert into public.agency_training_attendees values('31000000-0000-4000-8000-000000000001',$1,$2,'pending','2026-10-20 20:55:26.123456+00')", [department, eventId]);
  await pool.query("insert into public.audit_events(department_id,action,created_at) values($1,'update','2026-10-20 20:55:26.123456+00'),($1,'insert','2026-10-21 09:00:00.5+00')", [department]);
  await pool.query("insert into public.pilot_range_workspaces values($1,'{\"rangeDays\":[]}','2026-10-20 20:55:26.123456+00',null)", [department]);
  await pool.query("insert into public.local_times values($1,'2026-10-20 20:55:26.123456')", [department]);
});

after(async () => { await pool?.end(); await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
const client = () => new PostgresDataClient(pool, user, department);

test("AWS-native reads return timestamps as PostgREST ISO text at top level, in embedded relations and in RPC rows", async () => {
  const { data, error } = await client().from("agency_training_events").select("id,starts_at,agency_training_attendees(id,recorded_at)").eq("department_id", department);
  assert.equal(error, null);
  const [event] = data as Array<{ starts_at: unknown; agency_training_attendees: Array<{ recorded_at: unknown }> }>;
  const { rows: [expected] } = await pool.query("select to_json(starts_at) as starts_at from public.agency_training_events where id = $1", [eventId]);
  assert.equal(event.starts_at, expected.starts_at);
  assert.equal(event.agency_training_attendees[0].recorded_at, "2026-10-20T20:55:26.123456+00:00");
  const rpc = await client().rpc("list_member_joins");
  assert.deepEqual(rpc.data, [{ user_id: user, joined_at: "2026-10-20T20:55:26.123456+00:00" }]);
  const local = await client().from("local_times").select("observed_at").eq("department_id", department);
  assert.deepEqual(local.data, [{ observed_at: "2026-10-20T20:55:26.123456" }], `timestamp must not shift with the server zone (TZ=${process.env.TZ ?? "unset"})`);
});

test("Command Dashboard upcoming training and training attention lists are populated from AWS-native reads", async () => {
  const source = new SupabaseOperationsReadDataSource(client() as unknown as OperationsClient);
  const presentation = buildCommandOperationsPresentation(await source.listTrainingEvents(department), await source.listFleetVehicles(department), DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION);
  assert.deepEqual(presentation.agencyTraining.upcoming.map((item) => item.id), [eventId, unstaffedEventId]);
  assert.deepEqual(presentation.agencyTraining.attention.map((item) => item.id), [unstaffedEventId]);
  assert.equal(Date.parse(presentation.agencyTraining.upcoming[0].startsAt), startsAt.getTime());
});

test("audit feed rows keep a created_at string that orders and pairs events", async () => {
  const repository = new TenantBoundAdministrationReadRepository(new SupabaseAdministrationReadDataSource(client() as unknown as AdministrationClient), department);
  const rows = await repository.listAudit(department, "audit_events", "id,action,created_at", 10) as Array<{ action: string; created_at: unknown }>;
  assert.deepEqual(rows.map((row) => [row.action, row.created_at]), [["insert", "2026-10-21T09:00:00.5+00:00"], ["update", "2026-10-20T20:55:26.123456+00:00"]]);
});

test("an optimistic-concurrency update matches the microsecond updated_at it read", async () => {
  const data = client();
  const read = await data.from("pilot_range_workspaces").select("workspace,updated_at").eq("department_id", department).maybeSingle();
  const updatedAt = (read.data as { updated_at: unknown }).updated_at;
  const write = await data.from("pilot_range_workspaces").update({ workspace: { rangeDays: [{ id: "a" }] }, updated_at: new Date().toISOString() }).eq("department_id", department).eq("updated_at", updatedAt).select("workspace").maybeSingle();
  assert.equal(write.error, null);
  assert.deepEqual(write.data, { workspace: { rangeDays: [{ id: "a" }] } });
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { PostgresDataClient } from "../database/postgres-data-client.ts";
import { TenantBoundNotificationReadRepository, NotificationReadAuthorizationError, requireNotificationReadProvider } from "./read-repository-core.ts";
import { SupabaseNotificationReadDataSource } from "./read-repository-supabase.ts";

const tenant = "10000000-0000-4000-8000-000000000001";
const otherTenant = "10000000-0000-4000-8000-000000000002";
const user = "20000000-0000-4000-8000-000000000001";
const otherUser = "20000000-0000-4000-8000-000000000002";
let server: EmbeddedPostgres;
let pool: pg.Pool;
let directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-notifications-test-"));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-test-only", port, persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "local-test-only", database: "postgres" });
  await pool.query(`
    create role authenticated;
    create table public.notification_events (
      id uuid primary key, department_id uuid not null, user_id uuid not null,
      notification_key text not null, resolved_at timestamptz, last_seen_at timestamptz not null,
      acknowledged_at timestamptz, snoozed_until timestamptz,
      unique (department_id, user_id, notification_key)
    );
    create table public.notification_preferences (
      department_id uuid not null, user_id uuid not null, in_app_enabled boolean not null,
      email_enabled boolean not null, critical_email_only boolean not null,
      digest_mode text not null, source_preferences jsonb not null, updated_at timestamptz not null
    );
    grant usage on schema public to authenticated;
    grant select, insert, update on public.notification_events to authenticated;
    grant select on public.notification_preferences to authenticated;
    alter table public.notification_events enable row level security;
    alter table public.notification_preferences enable row level security;
    create policy own_events on public.notification_events to authenticated using (
      department_id = current_setting('tracepoint.department_id')::uuid
      and user_id = current_setting('tracepoint.subject_id')::uuid
    ) with check (
      department_id = current_setting('tracepoint.department_id')::uuid
      and user_id = current_setting('tracepoint.subject_id')::uuid
    );
    create policy own_preferences on public.notification_preferences to authenticated using (
      department_id = current_setting('tracepoint.department_id')::uuid
      and user_id = current_setting('tracepoint.subject_id')::uuid
    );
  `);
  await pool.query(`insert into public.notification_events values
    ('30000000-0000-4000-8000-000000000001',$1,$2,'older',null,'2026-09-01T00:00:00Z',null,null),
    ('30000000-0000-4000-8000-000000000002',$1,$2,'newer',null,'2026-09-02T00:00:00Z',null,null),
    ('30000000-0000-4000-8000-000000000003',$1,$2,'resolved','2026-09-03T00:00:00Z','2026-09-03T00:00:00Z',null,null),
    ('30000000-0000-4000-8000-000000000004',$3,$2,'other-tenant',null,'2026-09-04T00:00:00Z',null,null),
    ('30000000-0000-4000-8000-000000000005',$1,$4,'other-user',null,'2026-09-05T00:00:00Z',null,null)`, [tenant, user, otherTenant, otherUser]);
  await pool.query("insert into public.notification_preferences values($1,$2,true,false,true,'Daily','{}',now())", [tenant, user]);
});

after(async () => {
  await pool?.end();
  await server?.stop();
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function repository(subject = user, department = tenant) {
  const client = new PostgresDataClient(pool, subject, department);
  return new TenantBoundNotificationReadRepository(new SupabaseNotificationReadDataSource(client), department, subject);
}

test("PostgreSQL notification reads retain user and tenant scope, open state, and ordering", async () => {
  assert.equal(requireNotificationReadProvider("postgres"), "postgres");
  const repo = repository();
  assert.deepEqual((await repo.listNotificationEvents(tenant, user, true)).map(row => row.notification_key), ["newer", "older"]);
  assert.equal((await repo.listNotificationEvents(tenant, user)).length, 3);
  await assert.rejects(repo.listNotificationEvents(otherTenant, user), NotificationReadAuthorizationError);
  await assert.rejects(repo.listNotificationEvents(tenant, otherUser), NotificationReadAuthorizationError);
  assert.equal((await repo.getPreferences(tenant, user))?.digest_mode, "Daily");
});

test("PostgreSQL notification empty sets and absent preferences retain Supabase null contract", async () => {
  const repo = repository(otherUser, otherTenant);
  assert.deepEqual(await repo.listNotificationEvents(otherTenant, otherUser, true), []);
  assert.equal(await repo.getPreferences(otherTenant, otherUser), null);
});

test("PostgreSQL notification read-state update stays within authenticated user and tenant", async () => {
  const client = new PostgresDataClient(pool, user, tenant);
  const now = "2026-09-06T00:00:00Z";
  const own = await client.from("notification_events").update({ acknowledged_at: now })
    .eq("id", "30000000-0000-4000-8000-000000000001")
    .eq("department_id", tenant).eq("user_id", user);
  assert.equal(own.error, null);
  const foreign = await client.from("notification_events").update({ acknowledged_at: now })
    .eq("id", "30000000-0000-4000-8000-000000000005")
    .eq("department_id", otherTenant).eq("user_id", otherUser);
  assert.equal(foreign.error, null);
  const actual = await pool.query("select id,acknowledged_at from public.notification_events where id in ($1,$2) order by id", ["30000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000005"]);
  assert.ok(actual.rows[0].acknowledged_at);
  assert.equal(actual.rows[1].acknowledged_at, null);
});

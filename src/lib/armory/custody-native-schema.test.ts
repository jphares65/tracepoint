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

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-custody-native-"));
  database = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-only", port: await localPostgresPort(), persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await database.initialise();
  await database.start();
  client = database.getPgClient();
  await client.connect();
  await client.query(`
    create extension if not exists pgcrypto;
    create role anon nologin; create role authenticated nologin; create role service_role nologin; create role tracepoint_runtime nologin;
    create schema auth; create schema tracepoint_auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('tracepoint.subject_id',true),'')::uuid$$;
    create function tracepoint_auth.subject_id() returns uuid language sql stable as $$select auth.uid()$$;
    create function tracepoint_auth.department_id() returns uuid language sql stable as $$select nullif(current_setting('tracepoint.department_id',true),'')::uuid$$;
    create table public.departments(id uuid primary key, name text, slug text, is_active boolean default true);
    create table public.profiles(id uuid primary key, full_name text, email text);
    create table public.permissions(code text primary key, display_name text, description text);
    create table public.department_memberships(department_id uuid, user_id uuid, is_active boolean, primary key(department_id,user_id));
    create table public.firearms(id uuid primary key, department_id uuid references public.departments(id), is_active boolean default true, condition_status text default 'In Service');
    create table public.firearm_assignments(id uuid primary key, department_id uuid, firearm_id uuid, assigned_to_user_id uuid, returned_at timestamptz);
    create table public.audit_events(department_id uuid, actor_user_id uuid, action text, entity_type text, entity_id uuid, summary text, previous_value jsonb, new_value jsonb, details jsonb);
    create function public.is_department_member(p_department_id uuid) returns boolean language sql stable as $$select exists(select 1 from public.department_memberships where department_id=p_department_id and user_id=auth.uid() and is_active)$$;
    create function public.has_department_permission(p_department_id uuid,p_permission_code text) returns boolean language sql stable as $$select public.is_department_member(p_department_id)$$;
  `);
  await client.query(await readFile("database/aws/028_firearm_custody_phase_a.sql", "utf8"));
});

after(async () => { await client?.end().catch(() => undefined); await database?.stop().catch(() => undefined); await rm(directory, { recursive: true, force: true }); });

test("native custody transfer preserves assignment, rejects cross-tenant substitution, and is idempotent", async () => {
  const department = "10000000-0000-4000-8000-000000000001";
  const otherDepartment = "10000000-0000-4000-8000-000000000002";
  const user = "20000000-0000-4000-8000-000000000001";
  const firearm = "30000000-0000-4000-8000-000000000001";
  const assignment = "40000000-0000-4000-8000-000000000001";
  const location = "50000000-0000-4000-8000-000000000001";
  const key = "60000000-0000-4000-8000-000000000001";
  await client.query("insert into public.departments(id,name,slug) values($1,'A','a'),($2,'B','b')", [department, otherDepartment]);
  await client.query("insert into public.profiles(id,full_name,email) values($1,'A','a@example.test')", [user]);
  await client.query("insert into public.department_memberships values($1,$2,true)", [department, user]);
  await client.query("insert into public.firearms(id,department_id) values($1,$2)", [firearm, department]);
  await client.query("insert into public.firearm_assignments(id,department_id,firearm_id,assigned_to_user_id) values($1,$2,$3,$4)", [assignment, department, firearm, user]);
  await client.query("insert into public.firearm_storage_locations(id,department_id,name,created_by_user_id) values($1,$2,'Locker',$3)", [location, department, user]);
  await client.query("select set_config('tracepoint.subject_id',$1,false), set_config('tracepoint.department_id',$2,false)", [user, department]);
  const first = await client.query("select public.transfer_firearm_custody($1,'SECURE_STORAGE',null,$2,'secure return',null,$3,false) as id", [firearm, location, key]);
  const second = await client.query("select public.transfer_firearm_custody($1,'SECURE_STORAGE',null,$2,'secure return',null,$3,false) as id", [firearm, location, key]);
  assert.equal(first.rows[0].id, second.rows[0].id);
  assert.equal((await client.query("select returned_at is null as active from public.firearm_assignments where id=$1", [assignment])).rows[0].active, true);
  assert.equal((await client.query("select holder_type from public.firearm_current_custody where firearm_id=$1", [firearm])).rows[0].holder_type, "SECURE_STORAGE");
  assert.equal((await client.query("select count(*)::int as count from public.firearm_custody_events where firearm_id=$1", [firearm])).rows[0].count, 1);
  await client.query("select set_config('tracepoint.department_id',$1,false)", [otherDepartment]);
  await assert.rejects(() => client.query("select public.transfer_firearm_custody($1,'OFFICER',$2,null,'bad',null,'60000000-0000-4000-8000-000000000002',false)", [firearm, user]), /firearm unavailable/);
});

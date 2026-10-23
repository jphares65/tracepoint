import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";

// AT-2 (staging acceptance 2026-10-22): custody must follow the assignment. Returning an
// assignment releases its custody, and Duty Only on a re-issued firearm names the new
// assignee, never the officer of an earlier, returned assignment.
const require = createRequire(import.meta.url);
const { default: EmbeddedPostgres } = require("embedded-postgres") as { default: new (input: Record<string, unknown>) => { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; getPgClient(): { connect(): Promise<void>; end(): Promise<void>; query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> } } };

let directory = "";
let database: InstanceType<typeof EmbeddedPostgres>;
let client: ReturnType<InstanceType<typeof EmbeddedPostgres>["getPgClient"]>;
const migration067 = "database/aws/067_firearm_custody_follows_assignment.sql";

const department = "10000000-0000-4000-8000-000000000001";
const armorer = "20000000-0000-4000-8000-000000000001";
const kris = "20000000-0000-4000-8000-000000000002";
const eli = "20000000-0000-4000-8000-000000000003";
const location = "50000000-0000-4000-8000-000000000001";

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-custody-follows-"));
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
    create table public.firearm_assignments(id uuid primary key, department_id uuid, firearm_id uuid, assigned_to_user_id uuid, returned_at timestamptz, returned_by_user_id uuid);
    create table public.audit_events(department_id uuid, actor_user_id uuid, action text, entity_type text, entity_id uuid, summary text, previous_value jsonb, new_value jsonb, details jsonb);
    create function public.is_department_member(p_department_id uuid) returns boolean language sql stable as $$select exists(select 1 from public.department_memberships where department_id=p_department_id and user_id=auth.uid() and is_active)$$;
    create function public.has_department_permission(p_department_id uuid,p_permission_code text) returns boolean language sql stable as $$select public.is_department_member(p_department_id)$$;
  `);
  await client.query(await readFile("database/aws/028_firearm_custody_phase_a.sql", "utf8"));
  await client.query(await readFile("database/aws/031_restricted_firearm_simple_custody.sql", "utf8"));
  await client.query(await readFile(migration067, "utf8"));
  await client.query("insert into public.departments(id,name,slug) values($1,'A','a')", [department]);
  for (const [id, name] of [[armorer, "Armorer"], [kris, "Kris"], [eli, "Eli"]]) {
    await client.query("insert into public.profiles(id,full_name,email) values($1,$2,$3)", [id, name, `${name.toLowerCase()}@example.test`]);
    await client.query("insert into public.department_memberships values($1,$2,true)", [department, id]);
  }
  await client.query("insert into public.firearm_storage_locations(id,department_id,name,created_by_user_id) values($1,$2,'Vault',$3)", [location, department, armorer]);
  await client.query("select set_config('tracepoint.subject_id',$1,false), set_config('tracepoint.department_id',$2,false)", [armorer, department]);
});

after(async () => { await client?.end().catch(() => undefined); await database?.stop().catch(() => undefined); await rm(directory, { recursive: true, force: true }).catch(() => undefined); });

let sequence = 0;
const id = (prefix: string) => `${prefix}0000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const firearmWith = async () => { const firearm = id("3"); await client.query("insert into public.firearms(id,department_id) values($1,$2)", [firearm, department]); return firearm; };
const issue = async (firearm: string, officer: string) => { const assignment = id("4"); await client.query("insert into public.firearm_assignments(id,department_id,firearm_id,assigned_to_user_id) values($1,$2,$3,$4)", [assignment, department, firearm, officer]); return assignment; };
const giveBack = (assignment: string) => client.query("update public.firearm_assignments set returned_at=now(), returned_by_user_id=$2 where id=$1", [assignment, armorer]);
const restrict = async (firearm: string, type = "duty_only") => String((await client.query("select public.set_firearm_restriction($1,$2,null,'Synthetic restriction') as id", [firearm, type])).rows[0].id);
const unrestrict = (restriction: string) => client.query("select public.clear_firearm_restriction($1,'Synthetic clearance')", [restriction]);
const operate = (firearm: string, action: "CHECK_IN" | "CHECK_OUT") => client.query("select public.operate_restricted_firearm_custody($1,$2,$3,null,gen_random_uuid())", [firearm, action, action === "CHECK_IN" ? location : null]);
const custody = async (firearm: string) => (await client.query("select holder_type, holder_user_id, assignment_id, storage_location_id from public.firearm_current_custody where firearm_id=$1", [firearm])).rows[0] ?? null;
type Released = { actor_user_id: string | null; new_value: Record<string, unknown> };
const released = async (firearm: string) => (await client.query("select actor_user_id, new_value from public.audit_events where action='firearm_custody_released' and entity_id=$1", [firearm])).rows as Released[];

test("a re-issued Duty Only firearm names its new assignee, not the officer of the returned assignment", async () => {
  const firearm = await firearmWith();
  const first = await issue(firearm, kris);
  const firstRestriction = await restrict(firearm);
  assert.deepEqual(await custody(firearm), { holder_type: "OFFICER", holder_user_id: kris, assignment_id: first, storage_location_id: null });
  await operate(firearm, "CHECK_IN");
  await operate(firearm, "CHECK_OUT");
  await unrestrict(firstRestriction);
  await giveBack(first);
  assert.equal(await custody(firearm), null, "an officer holder is released when the assignment is returned");
  assert.deepEqual((await released(firearm)).map((row) => row.actor_user_id), [armorer], "the release is audited once, attributed to whoever returned it");

  const second = await issue(firearm, eli);
  await restrict(firearm);
  assert.deepEqual(await custody(firearm), { holder_type: "OFFICER", holder_user_id: eli, assignment_id: second, storage_location_id: null });
  await operate(firearm, "CHECK_IN");
  await operate(firearm, "CHECK_OUT");
  assert.equal((await custody(firearm))?.holder_user_id, eli, "restricted check-out goes to the current assignee");
});

test("a firearm returned while in secure storage stays in storage, unlinked from the returned assignment", async () => {
  const firearm = await firearmWith();
  const first = await issue(firearm, kris);
  const restriction = await restrict(firearm);
  await operate(firearm, "CHECK_IN");
  await unrestrict(restriction);
  await giveBack(first);
  assert.deepEqual(await custody(firearm), { holder_type: "SECURE_STORAGE", holder_user_id: null, assignment_id: null, storage_location_id: location });
  assert.equal((await released(firearm))[0].new_value.holder_type, "SECURE_STORAGE");

  const second = await issue(firearm, eli);
  await restrict(firearm);
  assert.deepEqual(await custody(firearm), { holder_type: "OFFICER", holder_user_id: eli, assignment_id: second, storage_location_id: null }, "issuing after storage places the firearm with the new assignee");
});

test("Duty Only keeps custody already recorded under the current assignment", async () => {
  const firearm = await firearmWith();
  const assignment = await issue(firearm, kris);
  await restrict(firearm);
  await operate(firearm, "CHECK_IN");
  await restrict(firearm, "duty_only");
  assert.deepEqual(await custody(firearm), { holder_type: "SECURE_STORAGE", holder_user_id: null, assignment_id: assignment, storage_location_id: location }, "re-restricting does not invent a check-out");
  await restrict(firearm, "no_carry");
  assert.equal((await custody(firearm))?.holder_type, "SECURE_STORAGE", "No Carry never moves custody");
});

test("returning an assignment that never had custody changes nothing", async () => {
  const firearm = await firearmWith();
  const assignment = await issue(firearm, kris);
  await giveBack(assignment);
  assert.equal(await custody(firearm), null);
  assert.equal((await released(firearm)).length, 0);
});

test("migration 067 corrects custody already left by returned assignments, and is safe to run again", async () => {
  const stale = await firearmWith();
  const staleAssignment = await issue(stale, kris);
  const stored = await firearmWith();
  const storedAssignment = await issue(stored, kris);
  const current = await firearmWith();
  const currentAssignment = await issue(current, eli);
  // Rows as the pre-067 functions left them: the assignments were returned without releasing custody.
  await client.query("alter table public.firearm_assignments disable trigger firearm_assignments_release_custody");
  await client.query("insert into public.firearm_current_custody(firearm_id,department_id,assignment_id,holder_type,holder_user_id) values($1,$2,$3,'OFFICER',$4)", [stale, department, staleAssignment, kris]);
  await client.query("insert into public.firearm_current_custody(firearm_id,department_id,assignment_id,holder_type,storage_location_id) values($1,$2,$3,'SECURE_STORAGE',$4)", [stored, department, storedAssignment, location]);
  await client.query("insert into public.firearm_current_custody(firearm_id,department_id,assignment_id,holder_type,holder_user_id) values($1,$2,$3,'OFFICER',$4)", [current, department, currentAssignment, eli]);
  await giveBack(staleAssignment);
  await giveBack(storedAssignment);
  await client.query("alter table public.firearm_assignments enable trigger firearm_assignments_release_custody");

  await client.query(await readFile(migration067, "utf8"));
  assert.equal(await custody(stale), null);
  assert.deepEqual(await custody(stored), { holder_type: "SECURE_STORAGE", holder_user_id: null, assignment_id: null, storage_location_id: location });
  assert.deepEqual(await custody(current), { holder_type: "OFFICER", holder_user_id: eli, assignment_id: currentAssignment, storage_location_id: null }, "custody of an active assignment is untouched");
  assert.equal((await released(stale))[0].new_value.migration, "067");

  await client.query(await readFile(migration067, "utf8"));
  assert.equal((await released(stale)).length + (await released(stored)).length, 2, "a second run finds nothing to correct");
});

test("the release function cannot be called directly by application roles", async () => {
  const grants = (await client.query("select grantee from information_schema.routine_privileges where routine_name='release_returned_assignment_custody' and grantee in ('anon','authenticated','service_role','tracepoint_runtime','PUBLIC')")).rows;
  assert.deepEqual(grants, []);
  const trigger = (await client.query("select tgenabled from pg_trigger where tgname='firearm_assignments_release_custody'")).rows[0];
  assert.equal(trigger?.tgenabled, "O");
});

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { custodyTransferFailure, custodyTransferRequest, parseCustodyTransferRequest } from "./custody-transfer.ts";

// SV-28: the ordinary custody transfer the route sends, run against the real
// 028 function (with 031 applied, as on AWS-native). Unlike
// custody-native-schema.test.ts, permissions are granted per user here, so the
// check-in / check-out split that 028 enforces is exercised.
const require = createRequire(import.meta.url);
const { default: EmbeddedPostgres } = require("embedded-postgres") as { default: new (input: Record<string, unknown>) => { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; getPgClient(): { connect(): Promise<void>; end(): Promise<void>; query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> } } };

let directory = "";
let database: InstanceType<typeof EmbeddedPostgres>;
let client: ReturnType<InstanceType<typeof EmbeddedPostgres>["getPgClient"]>;

const department = "10000000-0000-4000-8000-000000000001";
const officer = "20000000-0000-4000-8000-000000000001";
const custodian = "20000000-0000-4000-8000-000000000002";
const checkInOnly = "20000000-0000-4000-8000-000000000003";
const outsider = "20000000-0000-4000-8000-000000000009";
const firearm = "30000000-0000-4000-8000-000000000001";
const assignment = "40000000-0000-4000-8000-000000000001";
const location = "50000000-0000-4000-8000-000000000001";
const retiredLocation = "50000000-0000-4000-8000-000000000002";
const key = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-custody-transfer-"));
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
    create table public.test_user_permissions(department_id uuid, user_id uuid, code text);
    create table public.firearms(id uuid primary key, department_id uuid references public.departments(id), is_active boolean default true, condition_status text default 'In Service');
    create table public.firearm_assignments(id uuid primary key, department_id uuid, firearm_id uuid, assigned_to_user_id uuid, returned_at timestamptz);
    create table public.audit_events(department_id uuid, actor_user_id uuid, action text, entity_type text, entity_id uuid, summary text, previous_value jsonb, new_value jsonb, details jsonb);
    create function public.is_department_member(p_department_id uuid) returns boolean language sql stable as $$select exists(select 1 from public.department_memberships where department_id=p_department_id and user_id=auth.uid() and is_active)$$;
    create function public.has_department_permission(p_department_id uuid,p_permission_code text) returns boolean language sql stable as $$select public.is_department_member(p_department_id) and exists(select 1 from public.test_user_permissions where department_id=p_department_id and user_id=auth.uid() and code=p_permission_code)$$;
  `);
  await client.query(await readFile("database/aws/028_firearm_custody_phase_a.sql", "utf8"));
  await client.query(await readFile("database/aws/031_restricted_firearm_simple_custody.sql", "utf8"));
  await client.query("insert into public.departments(id,name,slug) values($1,'A','a')", [department]);
  await client.query("insert into public.profiles(id,full_name,email) select id,'U',id::text||'@example.test' from unnest($1::uuid[]) id", [[officer, custodian, checkInOnly, outsider]]);
  await client.query("insert into public.department_memberships select $1::uuid, id, true from unnest($2::uuid[]) id", [department, [officer, custodian, checkInOnly]]);
  await client.query("insert into public.test_user_permissions values ($1::uuid,$2::uuid,'firearm_custody.check_in'),($1::uuid,$2::uuid,'firearm_custody.check_out'),($1::uuid,$2::uuid,'manage_firearm_restrictions'),($1::uuid,$3::uuid,'firearm_custody.check_in')", [department, custodian, checkInOnly]);
  await client.query("insert into public.firearms(id,department_id) values($1,$2)", [firearm, department]);
  await client.query("insert into public.firearm_assignments(id,department_id,firearm_id,assigned_to_user_id) values($1,$2,$3,$4)", [assignment, department, firearm, officer]);
  await client.query("insert into public.firearm_storage_locations(id,department_id,name,created_by_user_id,is_active) values($1::uuid,$3::uuid,'Locker',$4::uuid,true),($2::uuid,$3::uuid,'Old vault',$4::uuid,false)", [location, retiredLocation, department, custodian]);
});

after(async () => { await client?.end().catch(() => undefined); await database?.stop().catch(() => undefined); await rm(directory, { recursive: true, force: true }).catch(() => undefined); });

const actAs = (user: string) => client.query("select set_config('tracepoint.subject_id',$1,false), set_config('tracepoint.department_id',$2,false)", [user, department]);

/** What the route does: parse the page's body, then call 028 with the parsed arguments. */
async function transfer(body: ReturnType<typeof custodyTransferRequest> | Record<string, unknown>) {
  const parsed = parseCustodyTransferRequest(firearm, body as Record<string, unknown>);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  if (!parsed.ok) throw new Error("unreachable");
  const a = parsed.args;
  try {
    const result = await client.query("select public.transfer_firearm_custody($1,$2,$3,$4,$5,$6,$7,$8) as id", [a.p_firearm_id, a.p_to_holder_type, a.p_to_holder_user_id, a.p_to_storage_location_id, a.p_reason, a.p_notes, a.p_idempotency_key, a.p_administrative_correction]);
    return { ok: true as const, id: result.rows[0].id };
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return { ok: false as const, ...custodyTransferFailure({ code: failure.code, message: failure.message }) };
  }
}
const holder = async () => (await client.query("select holder_type, holder_user_id, storage_location_id from public.firearm_current_custody where firearm_id=$1", [firearm])).rows[0];

test("SV-28: the page's ordinary check-in and check-out round-trip through 028 without changing assignment", async () => {
  await actAs(custodian);
  const first = await transfer(custodyTransferRequest({ direction: "CHECK_IN", storageLocationId: location, reason: "End of shift", notes: "Locker 4", idempotencyKey: key(1) }));
  assert.ok(first.ok);
  assert.deepEqual(await holder(), { holder_type: "SECURE_STORAGE", holder_user_id: null, storage_location_id: location });
  // A retry with the same key returns the same event (the page reuses its key).
  const retry = await transfer(custodyTransferRequest({ direction: "CHECK_IN", storageLocationId: location, reason: "End of shift", notes: "Locker 4", idempotencyKey: key(1) }));
  assert.equal(retry.ok && retry.id, first.ok && first.id);
  const out = await transfer(custodyTransferRequest({ direction: "CHECK_OUT", toHolderUserId: officer, reason: "Start of shift", idempotencyKey: key(2) }));
  assert.ok(out.ok);
  assert.deepEqual(await holder(), { holder_type: "OFFICER", holder_user_id: officer, storage_location_id: null });
  assert.equal((await client.query("select returned_at is null as active from public.firearm_assignments where id=$1", [assignment])).rows[0].active, true);
  const events = (await client.query("select action_type, reason, notes from public.firearm_custody_events where firearm_id=$1 order by occurred_at, action_type", [firearm])).rows;
  assert.deepEqual(events, [{ action_type: "INITIALIZE", reason: "End of shift", notes: "Locker 4" }, { action_type: "TRANSFER", reason: "Start of shift", notes: null }]);
  assert.equal((await client.query("select count(*)::int as count from public.audit_events where action='firearm_custody_transferred'")).rows[0].count, 2);
  assert.equal((await client.query("select count(*)::int as count from public.firearm_custody_events where action_type='ADMINISTRATIVE_CORRECTION'")).rows[0].count, 0);
});

test("SV-28: 028 enforces the check-in / check-out split the route mirrors", async () => {
  await actAs(checkInOnly);
  const refused = await transfer(custodyTransferRequest({ direction: "CHECK_OUT", toHolderUserId: officer, reason: "Issue", idempotencyKey: key(3) }));
  assert.deepEqual(refused, { ok: false, status: 403, error: "You do not have permission for this custody transfer." });
  assert.ok((await transfer(custodyTransferRequest({ direction: "CHECK_IN", storageLocationId: location, reason: "Secure", idempotencyKey: key(4) }))).ok);
  // The assigned officer alone holds no transfer permission.
  await actAs(officer);
  assert.equal((await transfer(custodyTransferRequest({ direction: "CHECK_OUT", toHolderUserId: officer, reason: "Mine", idempotencyKey: key(5) }))).ok, false);
});

test("SV-28: 028's validation refusals map to clear 400s", async () => {
  await actAs(custodian);
  assert.deepEqual(await transfer(custodyTransferRequest({ direction: "CHECK_OUT", toHolderUserId: outsider, reason: "x", idempotencyKey: key(6) })), { ok: false, status: 400, error: "The officer is not an active member of this agency." });
  assert.deepEqual(await transfer(custodyTransferRequest({ direction: "CHECK_IN", storageLocationId: retiredLocation, reason: "x", idempotencyKey: key(7) })), { ok: false, status: 400, error: "Choose an active secure-storage location." });
});

test("SV-28: Duty Only allows the ordinary transfer to the assignee; No Carry refuses check-out but allows check-in", async () => {
  await actAs(custodian);
  await client.query("select public.set_firearm_restriction($1,'duty_only',current_date,'training')", [firearm]);
  assert.ok((await transfer(custodyTransferRequest({ direction: "CHECK_OUT", toHolderUserId: officer, reason: "Duty", idempotencyKey: key(8) }))).ok);
  await client.query("select public.set_firearm_restriction($1,'no_carry',current_date,'review')", [firearm]);
  assert.ok((await transfer(custodyTransferRequest({ direction: "CHECK_IN", storageLocationId: location, reason: "No carry", idempotencyKey: key(9) }))).ok);
  assert.deepEqual(await transfer(custodyTransferRequest({ direction: "CHECK_OUT", toHolderUserId: officer, reason: "x", idempotencyKey: key(10) })), { ok: false, status: 409, error: "This firearm is restricted No Carry and cannot be checked out to an officer." });
});

test("Owner item 2/3: temporary custody to another officer leaves the assignment intact, is limited to active members of the same agency, and is fully audited", async () => {
  const otherDepartment = "10000000-0000-4000-8000-000000000002";
  const inactive = "20000000-0000-4000-8000-000000000004";
  const otherAgencyOfficer = "20000000-0000-4000-8000-000000000005";
  await client.query("insert into public.departments(id,name,slug) values($1,'B','b')", [otherDepartment]);
  await client.query("insert into public.profiles(id,full_name,email) values($1,'Inactive','i@example.test'),($2,'Other agency','o@example.test')", [inactive, otherAgencyOfficer]);
  await client.query("insert into public.department_memberships values($1,$2,false),($3,$4,true)", [department, inactive, otherDepartment, otherAgencyOfficer]);
  // Earlier tests left No Carry in force; temporary custody is not offered or allowed under it.
  await client.query("update public.firearm_possession_restrictions set is_active=false where firearm_id=$1", [firearm]);
  const assignmentBefore = (await client.query("select * from public.firearm_assignments where firearm_id=$1", [firearm])).rows;
  await actAs(custodian);
  for (const [recipient, label] of [[inactive, "inactive member"], [otherAgencyOfficer, "member of another agency"], [outsider, "non-member"]] as const) {
    const refused = await transfer(custodyTransferRequest({ direction: "CHECK_OUT", toHolderUserId: recipient, reason: "Temporary", idempotencyKey: crypto.randomUUID() }));
    assert.deepEqual(refused, { ok: false, status: 400, error: "The officer is not an active member of this agency." }, label);
  }
  const before = await holder();
  const temporary = await transfer(custodyTransferRequest({ direction: "CHECK_OUT", toHolderUserId: checkInOnly, reason: "Loaner while assigned officer's sidearm is repaired", notes: "Return by Friday", idempotencyKey: key(20) }));
  assert.ok(temporary.ok, JSON.stringify(temporary));
  assert.deepEqual(await holder(), { holder_type: "OFFICER", holder_user_id: checkInOnly, storage_location_id: null });
  assert.deepEqual((await client.query("select * from public.firearm_assignments where firearm_id=$1", [firearm])).rows, assignmentBefore, "the permanent assignment is unchanged");
  const event = (await client.query("select action_type, from_holder_type, from_holder_user_id, from_storage_location_id, to_holder_type, to_holder_user_id, initiating_user_id, assignment_id, reason, notes from public.firearm_custody_events where id=$1", [temporary.ok && temporary.id])).rows[0];
  assert.deepEqual(event, { action_type: "TRANSFER", from_holder_type: before.holder_type, from_holder_user_id: before.holder_user_id, from_storage_location_id: before.storage_location_id, to_holder_type: "OFFICER", to_holder_user_id: checkInOnly, initiating_user_id: custodian, assignment_id: assignment, reason: "Loaner while assigned officer's sidearm is repaired", notes: "Return by Friday" });
  const audit = (await client.query("select actor_user_id, previous_value->>'holder_type' as previous_holder, new_value->>'holder_user_id' as new_holder, new_value->>'assignment_id' as assignment_id, details->>'custody_event_id' as event_id from public.audit_events where action='firearm_custody_transferred' order by ctid desc limit 1")).rows[0];
  assert.deepEqual(audit, { actor_user_id: custodian, previous_holder: before.holder_type, new_holder: checkInOnly, assignment_id: assignment, event_id: temporary.ok ? String(temporary.id) : "" });
});

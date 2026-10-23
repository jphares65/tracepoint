import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";

import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { isAwsNativeSchemaFile } from "../../test-support/aws-native-schema-files.mjs";
import { supabasePrerequisites } from "../../../scripts/postgres-bootstrap-prerequisites.mjs";
import { PostgresDataClient } from "../database/postgres-data-client.ts";
import { restrictedCustodyFailure } from "./custody-transfer.ts";

// AT-2 on the full AWS-native schema (Supabase lineage plus database/aws 001-067), called as
// the runtime does (tracepoint_runtime -> authenticated, subject and agency set): custody
// names the active assignment's holder, history is kept, another agency cannot reach it, and
// a return racing a custody write never leaves custody naming the returned assignment.
const A = "a7200000-0000-4000-8000-00000000000a", B = "a7200000-0000-4000-8000-00000000000b";
const armorer = "a7200000-0000-4000-8000-0000000000a1", kris = "a7200000-0000-4000-8000-0000000000a2";
const eli = "a7200000-0000-4000-8000-0000000000a3", foreignArmorer = "a7200000-0000-4000-8000-0000000000b1";
const foreignOfficer = "a7200000-0000-4000-8000-0000000000b2";
const vault = "a7200000-0000-4000-8000-0000000005a1", foreignVault = "a7200000-0000-4000-8000-0000000005b1";
const armoryPermissions = ["manage_firearms", "manage_firearm_restrictions", "manage_restricted_firearm_custody",
  "firearm_custody.check_in", "firearm_custody.check_out"];
let server: EmbeddedPostgres, owner: pg.Pool, runtime: pg.Pool, directory: string, serial = 0;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-custody-follows-schema-"));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "synthetic-local-only", port, persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  owner = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "synthetic-local-only", database: "postgres" });
  await owner.query(supabasePrerequisites);
  for (const folder of ["supabase/migrations", "database/aws"]) {
    for (const file of (await readdir(folder)).filter(isAwsNativeSchemaFile).sort()) {
      await owner.query((await readFile(path.join(folder, file), "utf8")).replace(/^﻿/, ""));
    }
  }
  await owner.query("alter role tracepoint_runtime login password 'synthetic-runtime-only'");
  runtime = new pg.Pool({ host: "127.0.0.1", port, user: "tracepoint_runtime", password: "synthetic-runtime-only", database: "postgres", max: 6 });
  const people: Array<[string, string, string, string]> = [[armorer, "Avery Armorer", A, "armorer"], [kris, "Kris Tine", A, "officer"], [eli, "Eli Manning", A, "officer"],
    [foreignArmorer, "Foreign Armorer", B, "armorer"], [foreignOfficer, "Foreign Officer", B, "officer"]];
  for (const [id, name] of people) {
    await owner.query("insert into auth.users(id,email) values($1,$2)", [id, `${id.slice(-2)}@example.test`]);
    await owner.query("insert into public.profiles(id,full_name,email) values($1,$2,$3) on conflict(id) do update set full_name=excluded.full_name", [id, name, `${id.slice(-2)}@example.test`]);
  }
  await owner.query("insert into public.departments(id,name,short_name,slug,created_by) values($1,'AT-2 A','A','at2-a',$3),($2,'AT-2 B','B','at2-b',$4)", [A, B, armorer, foreignArmorer]);
  for (const [id, , department, role] of people) {
    await owner.query("insert into public.department_memberships(department_id,user_id,is_active,activation_status) values($1,$2,true,'activated')", [department, id]);
    await owner.query("insert into public.department_membership_roles(department_id,user_id,role_code) values($1,$2,$3) on conflict do nothing", [department, id, role]);
  }
  for (const department of [A, B]) {
    for (const permission of armoryPermissions) {
      await owner.query("insert into public.department_role_permissions(department_id,role_code,permission_code) values($1,'armorer',$2) on conflict do nothing", [department, permission]);
    }
  }
  await owner.query("insert into public.firearm_storage_locations(id,department_id,name,created_by_user_id) values($1,$3,'Vault',$4),($2,$5,'Foreign vault',$6)", [vault, foreignVault, A, armorer, B, foreignArmorer]);
});

after(async () => { await runtime?.end(); await owner?.end(); await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

async function begin(user: string, department: string) {
  const client = await runtime.connect();
  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query("select set_config('tracepoint.subject_id',$1,true),set_config('tracepoint.department_id',$2,true)", [user, department]);
  return client;
}
async function as<T>(user: string, department: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await begin(user, department);
  try { const result = await work(client); await client.query("commit"); return result; }
  catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}
const key = () => crypto.randomUUID();

async function firearm(department = A) {
  serial += 1;
  const id = crypto.randomUUID();
  await owner.query("insert into public.firearms(id,department_id,serial_number,make,model,caliber,firearm_type) values($1,$2,$3,'Glock','17','9mm','handgun')", [id, department, `AT2-${serial}`]);
  return id;
}
/** The assignments route's issue (insert) and return (update of the active row), as the armorer. */
async function issue(firearmId: string, officer: string, department = A, actor = armorer) {
  const id = crypto.randomUUID();
  await as(actor, department, (c) => c.query("insert into public.firearm_assignments(id,department_id,firearm_id,assigned_to_user_id,assigned_by_user_id) values($1,$2,$3,$4,$5)", [id, department, firearmId, officer, actor]));
  return id;
}
const returnSql = "update public.firearm_assignments set returned_at=now(),returned_by_user_id=$3,updated_at=now() where firearm_id=$1 and department_id=$2 and returned_at is null";
const giveBack = (firearmId: string, department = A, actor = armorer) => as(actor, department, (c) => c.query(returnSql, [firearmId, department, actor]));
const dutyOnly = (firearmId: string, department = A, actor = armorer) => as(actor, department, (c) => c.query("select public.set_firearm_restriction($1,'duty_only',current_date,'Duty only',null,null)", [firearmId]));
const operate = (c: pg.PoolClient, firearmId: string, action: string, location: string | null = null) => c.query("select public.operate_restricted_firearm_custody($1,$2,$3,null,$4)", [firearmId, action, location, key()]);
const custody = async (firearmId: string) => (await owner.query("select assignment_id,holder_type,holder_user_id,storage_location_id from public.firearm_current_custody where firearm_id=$1", [firearmId])).rows[0] ?? null;
const count = async (sql: string, values: unknown[]) => Number((await owner.query(sql, values)).rows[0].n);

test("acceptance A5/A6: custody follows the returned and re-issued assignment; history is kept", async () => {
  const gun = await firearm();
  const first = await issue(gun, kris);
  await dutyOnly(gun);
  assert.deepEqual(await custody(gun), { assignment_id: first, holder_type: "OFFICER", holder_user_id: kris, storage_location_id: null });
  await as(armorer, A, (c) => operate(c, gun, "CHECK_IN", vault));
  await as(armorer, A, (c) => operate(c, gun, "CHECK_OUT"));
  const events = await count("select count(*) n from public.firearm_custody_events where firearm_id=$1", [gun]);
  assert.equal(events, 2);

  await giveBack(gun);
  assert.equal(await custody(gun), null, "an officer holder of a returned assignment is released");
  assert.equal(await count("select count(*) n from public.audit_events where entity_id=$1 and action='firearm_custody_released' and actor_user_id=$2", [gun, armorer]), 1);
  assert.equal(await count("select count(*) n from public.firearm_custody_events where firearm_id=$1", [gun]), events, "custody history is never rewritten");

  const second = await issue(gun, eli);
  await dutyOnly(gun);
  assert.deepEqual(await custody(gun), { assignment_id: second, holder_type: "OFFICER", holder_user_id: eli, storage_location_id: null });
  // A check-in now starts from Eli: the custody event records him, never Kris, as the holder handing it over.
  await as(armorer, A, (c) => operate(c, gun, "CHECK_IN", vault));
  const handover = (await owner.query("select assignment_id,from_holder_user_id from public.firearm_custody_events where firearm_id=$1 order by occurred_at desc limit 1", [gun])).rows[0];
  assert.deepEqual(handover, { assignment_id: second, from_holder_user_id: eli });
});

test("a firearm returned while in secure storage stays in storage, unlinked from the returned assignment", async () => {
  const gun = await firearm();
  await issue(gun, kris);
  await dutyOnly(gun);
  await as(armorer, A, (c) => operate(c, gun, "CHECK_IN", vault));
  await giveBack(gun);
  assert.deepEqual(await custody(gun), { assignment_id: null, holder_type: "SECURE_STORAGE", holder_user_id: null, storage_location_id: vault });
  await assert.rejects(as(armorer, A, (c) => operate(c, gun, "CHECK_OUT")), /active assigned firearm restriction required/);
  assert.deepEqual(await custody(gun), { assignment_id: null, holder_type: "SECURE_STORAGE", holder_user_id: null, storage_location_id: vault });
});

test("another agency cannot restrict, transfer or return this agency's firearm, and its own custody is untouched", async () => {
  const gun = await firearm();
  const assignment = await issue(gun, kris);
  await dutyOnly(gun);
  const foreignGun = await firearm(B);
  const foreignAssignment = await issue(foreignGun, foreignOfficer, B, foreignArmorer);
  await dutyOnly(foreignGun, B, foreignArmorer);

  await assert.rejects(dutyOnly(gun, B, foreignArmorer), /invalid firearm restriction/);
  await assert.rejects(as(foreignArmorer, B, (c) => c.query("select public.transfer_firearm_custody($1,'SECURE_STORAGE',null,$2,'move',null,$3,false)", [gun, foreignVault, key()])), /firearm unavailable/);
  const returned = await as(foreignArmorer, B, (c) => c.query(returnSql, [gun, A, foreignArmorer]));
  assert.equal(returned.rowCount, 0, "another agency's return reaches no row");
  assert.deepEqual(await custody(gun), { assignment_id: assignment, holder_type: "OFFICER", holder_user_id: kris, storage_location_id: null });

  await giveBack(gun);
  assert.equal(await custody(gun), null);
  assert.deepEqual(await custody(foreignGun), { assignment_id: foreignAssignment, holder_type: "OFFICER", holder_user_id: foreignOfficer, storage_location_id: null });
});

test("custody cannot name an assignment that is returned, belongs to another firearm, or to another agency", async () => {
  const gun = await firearm(), other = await firearm(), foreignGun = await firearm(B);
  const returnedAssignment = await issue(gun, kris);
  await giveBack(gun);
  const otherAssignment = await issue(other, eli);
  const foreignAssignment = await issue(foreignGun, foreignOfficer, B, foreignArmorer);
  for (const assignment of [returnedAssignment, otherAssignment, foreignAssignment]) {
    await assert.rejects(owner.query("insert into public.firearm_current_custody(firearm_id,department_id,assignment_id,holder_type,holder_user_id) values($1,$2,$3,'OFFICER',$4)", [gun, A, assignment, kris]),
      (error: { code?: string }) => error.code === "40001");
  }
  assert.equal(await custody(gun), null);
});

/** Starts the return of the firearm's active assignment and leaves it uncommitted. */
async function pendingReturn(firearmId: string) {
  const client = await begin(armorer, A);
  await client.query(returnSql, [firearmId, A, armorer]);
  return client;
}
async function finish(client: pg.PoolClient, outcome: "commit" | "rollback") { try { await client.query(outcome); } finally { client.release(); } }

async function raceInitialTransfer() {
  const gun = await firearm();
  await issue(gun, kris);
  const returning = await pendingReturn(gun);
  const transfer = as(armorer, A, (c) => c.query("select public.transfer_firearm_custody($1,'OFFICER',$2,null,'issue',null,$3,false)", [gun, kris, key()]));
  const settled = transfer.then(() => "applied", (error: { code?: string }) => error.code ?? "failed");
  await new Promise((resolve) => setTimeout(resolve, 300));
  await finish(returning, "commit");
  return { gun, outcome: await settled };
}
async function raceCheckOut() {
  const gun = await firearm();
  await issue(gun, kris);
  await dutyOnly(gun);
  await as(armorer, A, (c) => operate(c, gun, "CHECK_IN", vault));
  const events = await count("select count(*) n from public.firearm_custody_events where firearm_id=$1", [gun]);
  const returning = await pendingReturn(gun);
  const checkOut = as(armorer, A, (c) => operate(c, gun, "CHECK_OUT"));
  const settled = checkOut.then(() => "applied", (error: { code?: string }) => error.code ?? "failed");
  await new Promise((resolve) => setTimeout(resolve, 300));
  await finish(returning, "commit");
  return { gun, events, outcome: await settled };
}

test("a custody write racing a return is refused as a whole; custody never names the returned assignment", async () => {
  const initial = await raceInitialTransfer();
  assert.equal(initial.outcome, "40001");
  assert.equal(await custody(initial.gun), null);
  assert.equal(await count("select count(*) n from public.firearm_custody_events where firearm_id=$1", [initial.gun]), 0, "the refused transfer records no event");

  const checkOut = await raceCheckOut();
  assert.equal(checkOut.outcome, "40001");
  assert.deepEqual(await custody(checkOut.gun), { assignment_id: null, holder_type: "SECURE_STORAGE", holder_user_id: null, storage_location_id: vault });
  assert.equal(await count("select count(*) n from public.firearm_custody_events where firearm_id=$1", [checkOut.gun]), checkOut.events, "the refused check-out records no event");
});

test("without the 067 guard the same races leave custody naming the returned officer (the defect this guards)", async () => {
  await owner.query("alter table public.firearm_current_custody disable trigger firearm_current_custody_active_assignment");
  try {
    const initial = await raceInitialTransfer();
    assert.equal(initial.outcome, "applied");
    assert.equal((await custody(initial.gun)).holder_user_id, kris);
    const checkOut = await raceCheckOut();
    assert.equal(checkOut.outcome, "applied");
    assert.equal((await custody(checkOut.gun)).holder_user_id, kris);
  } finally {
    await owner.query("alter table public.firearm_current_custody enable trigger firearm_current_custody_active_assignment");
  }
});

// AT-4 (staging acceptance 2026-10-22, A4/A5): the database's reasons for refusing a restriction or custody change
// reached the officer as 409 "PostgreSQL data operation failed." (and a second check-in raised errcode '409', which
// PostgreSQL replaced with 42704). Through the runtime's data client and the route's mapping they are now explained.
test("AT-4 restriction and custody refusals reach the user as their reasons, through the real data client", async () => {
  const client = new PostgresDataClient(runtime, armorer, A);
  const refusal = async (name: string, args: Record<string, unknown>) => {
    const result = await client.rpc(name, args);
    assert.ok(result.error, `${name} was refused`);
    return { raw: result.error, mapped: restrictedCustodyFailure(result.error) };
  };
  const unissued = await firearm();
  const noAssignment = await refusal("set_firearm_restriction", { p_firearm_id: unissued, p_restriction_type: "duty_only", p_effective_date: null, p_reason: "r", p_notes: null, p_review_date: null });
  assert.deepEqual(noAssignment.raw, { message: "restricted use requires an active assignment", code: "22023" });
  assert.deepEqual(noAssignment.mapped, { status: 409, error: "Issue this firearm to an officer before restricting it." });

  const gun = await firearm();
  await issue(gun, kris);
  const restriction = String((await client.rpc("set_firearm_restriction", { p_firearm_id: gun, p_restriction_type: "duty_only", p_effective_date: null, p_reason: "r", p_notes: null, p_review_date: null })).data);
  const checkIn = () => client.rpc("operate_restricted_firearm_custody", { p_firearm_id: gun, p_action: "CHECK_IN", p_storage_location_id: vault, p_notes: null, p_idempotency_key: key() });
  assert.equal((await checkIn()).error, null);
  const second = await checkIn();
  assert.deepEqual(second.error, { message: "firearm is not ready for this custody action", code: "55000" }, "a second check-in is refused with its reason, not 42704");
  assert.deepEqual(restrictedCustodyFailure(second.error!), { status: 409, error: "This firearm is already checked in or out. Reload it to see where it is." });

  assert.equal((await client.rpc("clear_firearm_restriction", { p_restriction_id: restriction, p_reason: "done" })).error, null);
  const again = await refusal("clear_firearm_restriction", { p_restriction_id: restriction, p_reason: "again" });
  assert.deepEqual(again.mapped, { status: 409, error: "This restriction is no longer active. Reload the firearm to see its current restrictions." });

  const officer = new PostgresDataClient(runtime, eli, A);
  const denied = await officer.rpc("set_firearm_restriction", { p_firearm_id: gun, p_restriction_type: "no_carry", p_effective_date: null, p_reason: "r", p_notes: null, p_review_date: null });
  assert.deepEqual(restrictedCustodyFailure(denied.error!), { status: 403, error: "Restriction-management permission is required." });
});

test("AT-4 an ordinary database error still reaches the user only as a generic message", async () => {
  const client = new PostgresDataClient(runtime, armorer, A);
  const result = await client.rpc("set_firearm_restriction", { p_firearm_id: "not-a-uuid", p_restriction_type: "duty_only", p_effective_date: null, p_reason: "r", p_notes: null, p_review_date: null });
  assert.deepEqual(result.error, { message: "PostgreSQL data operation failed.", code: "22P02" });
  assert.equal(restrictedCustodyFailure(result.error!).error, "The firearm restriction or custody could not be updated.");
});

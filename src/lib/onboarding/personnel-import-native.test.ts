import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";

import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { supabasePrerequisites } from "../../../scripts/postgres-bootstrap-prerequisites.mjs";

// F1: personnel re-import on the full AWS-native schema (Supabase lineage plus
// database/aws), through the functions the Cognito writer and the membership
// lifecycle call, in the request context withPostgresAuthorization sets.
const A = "dddddddd-0000-4000-8000-00000000000a", B = "dddddddd-0000-4000-8000-00000000000b";
const admin = "a0000000-0000-4000-8000-0000000000a1", admin2 = "a0000000-0000-4000-8000-0000000000a2";
const manager = "a0000000-0000-4000-8000-0000000000b1", officer = "a0000000-0000-4000-8000-0000000000c1";
const newcomer = "a0000000-0000-4000-8000-0000000000d1", platform = "90000000-0000-4000-8000-000000000001";
const issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TESTPOOL";
const databaseName = "postgres";
let server: EmbeddedPostgres, owner: pg.Pool, runtime: pg.Pool, directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-personnel-import-"));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "synthetic-local-only", port, persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  owner = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "synthetic-local-only", database: databaseName });
  await owner.query(supabasePrerequisites);
  for (const folder of ["supabase/migrations", "database/aws"]) {
    for (const file of (await readdir(folder)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
      await owner.query((await readFile(path.join(folder, file), "utf8")).replace(/^﻿/, ""));
    }
  }
  await owner.query("alter role tracepoint_runtime login password 'synthetic-runtime-only'");
  runtime = new pg.Pool({ host: "127.0.0.1", port, user: "tracepoint_runtime", password: "synthetic-runtime-only", database: databaseName });
  const people: Array<[string, string]> = [[admin, "admin"], [admin2, "admin2"], [manager, "manager"], [officer, "officer"], [newcomer, "newcomer"], [platform, "platform"]];
  for (const [id, name] of people) {
    await owner.query("insert into auth.users(id,email) values($1,$2)", [id, `${name}@example.test`]);
    await owner.query("insert into public.profiles(id,full_name,email,phone) values($1,$2,$3,'555-0100') on conflict(id) do update set full_name=excluded.full_name,email=excluded.email,phone=excluded.phone", [id, name, `${name}@example.test`]);
    await owner.query("insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username) values('cognito',$1,$2,$3,'active',$2)", [issuer, `sub-${name}`, id]);
  }
  await owner.query("insert into public.departments(id,name,short_name,slug,created_by) values($1,'Dept A','DA','dept-a',$3),($2,'Dept B','DB','dept-b',$3)", [A, B, admin]);
  await owner.query("insert into public.platform_admins(user_id,display_name,is_active) values($1,'Platform',true)", [platform]);
  await owner.query(`insert into public.department_memberships(department_id,user_id,badge_number,rank_title,unit_name,employee_number,is_active,activation_status)
    values($1,$2,'A-1',null,null,null,true,'activated'),($1,$3,'B-1',null,null,null,true,'activated'),
          ($1,$4,'S-7','Sergeant','Patrol','E-7',true,'activated'),($5,$6,'N-1',null,null,null,true,'activated')`, [A, admin, manager, officer, B, newcomer]);
  await owner.query(`insert into public.department_membership_roles(department_id,user_id,role_code)
    values($1,$2,'administrator'),($1,$3,'supervisor'),($1,$4,'supervisor'),($5,$6,'officer')`, [A, admin, manager, officer, B, newcomer]);
  // An agency can grant user management to a non-Administrator role.
  await owner.query("insert into public.department_role_permissions(department_id,role_code,permission_code) values($1,'supervisor','manage_users') on conflict do nothing", [A]);
});

after(async () => { await runtime?.end(); await owner?.end(); await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

// One request transaction as tracepoint_runtime, role authenticated, subject and agency set.
async function as<T>(subject: string, work: (client: pg.PoolClient) => Promise<T>, support = false): Promise<T> {
  const client = await runtime.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('tracepoint.subject_id',$1,true),set_config('tracepoint.department_id',$2,true)", [subject, A]);
    if (support) await client.query("select set_config('tracepoint.support_department_id',$1,true)", [A]);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}
// fields: badge, employee number, rank, unit (the function's parameter order).
const attach = (subject: string, email: string, fields: [string, string, string, string]) => as(subject, async (client) =>
  (await client.query("select public.attach_existing_cognito_personnel_import($1,$2,$3,$4,$5,$6,$7) as r", [A, email, "Imported Name", ...fields])).rows[0].r);
const prepare = (subject: string, target: string, kind: "disable" | "enable", support = false) => as(subject, async (client) =>
  (await client.query("select * from tracepoint_auth.prepare_cognito_membership_operation(gen_random_uuid(),$1,$2,$3)", [kind, A, target])).rows[0], support);
const member = async (user: string) => (await owner.query("select badge_number,rank_title,unit_name,employee_number,is_active from public.department_memberships where department_id=$1 and user_id=$2", [A, user])).rows[0];
const roles = async (user: string) => (await owner.query("select array_agg(role_code order by role_code) r from public.department_membership_roles where department_id=$1 and user_id=$2", [A, user])).rows[0].r;

test("re-importing an existing member with blank fields keeps badge, rank, unit and employee number", async () => {
  await attach(admin, "officer@example.test", ["", " ", "", ""]);
  assert.deepEqual(await member(officer), { badge_number: "S-7", rank_title: "Sergeant", unit_name: "Patrol", employee_number: "E-7", is_active: true });
  await attach(admin, "officer@example.test", ["S-8", "", "Lieutenant", ""]);
  assert.deepEqual(await member(officer), { badge_number: "S-8", rank_title: "Lieutenant", unit_name: "Patrol", employee_number: "E-7", is_active: true });
});

test("re-importing an existing member keeps their roles and does not add Officer", async () => {
  await attach(admin, "officer@example.test", ["S-8", "", "", ""]);
  assert.deepEqual(await roles(officer), ["supervisor"]);
  await attach(admin, "admin@example.test", ["A-1", "", "", ""]);
  assert.deepEqual(await roles(admin), ["administrator"]);
});

test("an existing identity new to this agency still gets an inactive membership and the default Officer role", async () => {
  const result = await attach(admin, "newcomer@example.test", ["N-9", "E-9", "", ""]);
  assert.equal(result.user_id, newcomer);
  assert.deepEqual(await member(newcomer), { badge_number: "N-9", rank_title: null, unit_name: null, employee_number: "E-9", is_active: false });
  assert.deepEqual(await roles(newcomer), ["officer"]);
});

test("the AI importer update keeps stored values for blank fields", async () => {
  const update = (fields: string[]) => as(admin, (client) => client.query("select public.update_cognito_personnel_import($1,$2,'officer@example.test','Officer Renamed',$3,$4,$5,$6,$7)", [A, officer, ...fields]));
  const before = await member(officer);
  await update(["", "", "", "", ""]);
  assert.deepEqual(await member(officer), before);
  assert.equal((await owner.query("select phone from public.profiles where id=$1", [officer])).rows[0].phone, "555-0100");
  await update(["555-0199", "", "E-70", "", "Traffic"]);
  assert.deepEqual(await member(officer), { ...before, employee_number: "E-70", unit_name: "Traffic" });
});

test("an Administrator cannot deactivate themselves through import", async () => {
  await assert.rejects(prepare(admin, admin, "disable"), /self deactivation is not permitted/);
  assert.equal((await member(admin)).is_active, true);
});

test("import cannot deactivate the agency's final Administrator", async () => {
  await assert.rejects(prepare(platform, admin, "disable", true), /must retain at least one active Administrator/);
  assert.equal((await member(admin)).is_active, true);
  assert.equal((await owner.query("select count(*)::int n from public.authentication_session_revocations where tracepoint_user_id=$1", [admin])).rows[0].n, 0);
});

test("only an Administrator may deactivate another Administrator through import", async () => {
  await owner.query("insert into public.department_memberships(department_id,user_id,badge_number,is_active,activation_status) values($1,$2,'A-2',true,'activated')", [A, admin2]);
  await owner.query("insert into public.department_membership_roles(department_id,user_id,role_code) values($1,$2,'administrator')", [A, admin2]);
  await assert.rejects(prepare(manager, admin2, "disable"), /Only a department Administrator may modify an Administrator account/);
  assert.equal((await member(admin2)).is_active, true);
  const prepared = await prepare(admin, admin2, "disable");
  assert.equal(prepared.should_change_provider, true);
  assert.equal((await member(admin2)).is_active, false);
});

test("explicit Active=No from a user manager deactivates an officer and revokes their sessions", async () => {
  const prepared = await prepare(manager, officer, "disable");
  assert.equal(prepared.should_change_provider, true);
  assert.equal((await member(officer)).is_active, false);
  assert.equal((await owner.query("select count(*)::int n from public.authentication_session_revocations where tracepoint_user_id=$1", [officer])).rows[0].n, 1);
});

test("migration 044 is repeatable and keeps the request-role grants", async () => {
  await owner.query(await readFile("database/aws/054_personnel_import_preservation.sql", "utf8"));
  for (const signature of [
    "public.attach_existing_cognito_personnel_import(uuid,text,text,text,text,text,text)",
    "public.update_cognito_personnel_import(uuid,uuid,text,text,text,text,text,text,text)",
    "tracepoint_auth.prepare_cognito_membership_operation(uuid,text,uuid,uuid)",
  ]) {
    const grants = (await owner.query("select has_function_privilege('authenticated',$1,'execute') a, has_function_privilege('anon',$1,'execute') n", [signature])).rows[0];
    assert.deepEqual(grants, { a: true, n: false }, signature);
  }
});

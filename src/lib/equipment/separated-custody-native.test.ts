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

// B9: custody held by a separated (inactive) member on the full AWS-native schema
// (Supabase lineage plus database/aws), in the request context
// withPostgresAuthorization sets (tracepoint_runtime -> authenticated).
const A = "dddddddd-0000-4000-8000-00000000000a", B = "dddddddd-0000-4000-8000-00000000000b";
const admin = "a0000000-0000-4000-8000-0000000000a1", quartermaster = "a0000000-0000-4000-8000-0000000000e1";
const officer = "a0000000-0000-4000-8000-0000000000c1", separated = "a0000000-0000-4000-8000-0000000000c2";
const foreignAdmin = "b0000000-0000-4000-8000-0000000000a1", foreignOfficer = "b0000000-0000-4000-8000-0000000000c1";
const typeId = "e7000000-0000-4000-8000-00000000000a", vehicle = "feee0000-0000-4000-8000-00000000000a";
const vest = "ea000000-0000-4000-8000-000000000001", radio = "ea000000-0000-4000-8000-000000000002";
const taser = "ea000000-0000-4000-8000-000000000003", spare = "ea000000-0000-4000-8000-000000000004";
const aed = "ea000000-0000-4000-8000-000000000005", firearm = "fa000000-0000-4000-8000-000000000001";
const databaseName = "postgres";
const issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TESTPOOL";
let server: EmbeddedPostgres, owner: pg.Pool, runtime: pg.Pool, directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-separated-custody-"));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "synthetic-local-only", port, persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  owner = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "synthetic-local-only", database: databaseName });
  await owner.query(supabasePrerequisites);
  for (const folder of ["supabase/migrations", "database/aws"]) {
    for (const file of (await readdir(folder)).filter(isAwsNativeSchemaFile).sort()) {
      await owner.query((await readFile(path.join(folder, file), "utf8")).replace(/^﻿/, ""));
    }
  }
  await owner.query("alter role tracepoint_runtime login password 'synthetic-runtime-only'");
  runtime = new pg.Pool({ host: "127.0.0.1", port, user: "tracepoint_runtime", password: "synthetic-runtime-only", database: databaseName });
  const people: Array<[string, string]> = [[admin, "Agency Admin"], [quartermaster, "Quinn Quartermaster"], [officer, "Olive Officer"], [separated, "Sam Separated"], [foreignAdmin, "Foreign Admin"], [foreignOfficer, "Foreign Officer"]];
  for (const [id, name] of people) {
    await owner.query("insert into auth.users(id,email) values($1,$2)", [id, `${id.slice(0, 8)}-${id.slice(-2)}@example.test`]);
    await owner.query("insert into public.profiles(id,full_name,email) values($1,$2,$3) on conflict(id) do update set full_name=excluded.full_name", [id, name, `${id.slice(-2)}@example.test`]);
  }
  await owner.query("insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username) values('cognito',$1,'sub-separated',$2,'active','separated')", [issuer, separated]);
  await owner.query("insert into public.departments(id,name,short_name,slug,created_by) values($1,'Dept A','DA','dept-a',$3),($2,'Dept B','DB','dept-b',$4)", [A, B, admin, foreignAdmin]);
  await owner.query(`insert into public.department_memberships(department_id,user_id,badge_number,is_active,activation_status)
    values($1,$3,'A-1',true,'activated'),($1,$4,'Q-1',true,'activated'),($1,$5,'O-1',true,'activated'),($1,$6,'S-44',true,'activated'),
          ($2,$7,'F-1',true,'activated'),($2,$8,'F-2',false,'activated')`, [A, B, admin, quartermaster, officer, separated, foreignAdmin, foreignOfficer]);
  await owner.query(`insert into public.department_membership_roles(department_id,user_id,role_code)
    values($1,$3,'administrator'),($1,$4,'armorer'),($1,$5,'officer'),($1,$6,'officer'),($2,$7,'administrator'),($2,$8,'officer')`, [A, B, admin, quartermaster, officer, separated, foreignAdmin, foreignOfficer]);
  await owner.query("insert into public.department_role_permissions(department_id,role_code,permission_code) values($1,'armorer','manage_equipment') on conflict do nothing", [A]);
  await owner.query("insert into public.equipment_types(id,department_id,name) values($1,$2,'Radio')", [typeId, A]);
  await owner.query("insert into public.fleet_vehicles(id,department_id,unit_number) values($1,$2,'3101')", [vehicle, A]);
  // Issued while the officer was active: history opens through the trigger.
  for (const id of [vest, radio, taser]) {
    await owner.query("insert into public.equipment_assets(id,department_id,equipment_type_id,serial_number,assigned_user_id,created_by,updated_by) values($1,$2,$3,$6,$4,$5,$5)", [id, A, typeId, separated, quartermaster, `SN-${id.slice(-2)}`]);
  }
  await owner.query("insert into public.equipment_assets(id,department_id,equipment_type_id,serial_number,created_by,updated_by) values($1,$2,$3,'SN-spare',$4,$4)", [spare, A, typeId, quartermaster]);
  await owner.query("insert into public.equipment_assets(id,department_id,equipment_type_id,serial_number,assigned_vehicle_id,created_by,updated_by) values($1,$2,$3,'SN-aed',$4,$5,$5)", [aed, A, typeId, vehicle, quartermaster]);
  await owner.query("insert into public.firearms(id,department_id,serial_number,make,model,caliber,firearm_type) values($1,$2,'P-1','Glock','17','9mm','handgun')", [firearm, A]);
  await owner.query("insert into public.firearm_assignments(department_id,firearm_id,assigned_to_user_id) values($1,$2,$3)", [A, firearm, separated]);
});

after(async () => { await runtime?.end(); await owner?.end(); await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

// One request transaction as tracepoint_runtime, role authenticated, subject and agency set.
async function as<T>(subject: string, department: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await runtime.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('tracepoint.subject_id',$1,true),set_config('tracepoint.department_id',$2,true)", [subject, department]);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}
const custody = async () => (await owner.query("select id, assigned_user_id, lifecycle_status from public.equipment_assets where department_id=$1 and assigned_user_id is not null order by id", [A])).rows;
const openHistory = async (asset: string) => (await owner.query("select assigned_user_id, returned_at, return_notes from public.equipment_asset_assignments where equipment_asset_id=$1 order by assigned_at", [asset])).rows;

test("deactivating a member (settings RPC and the Cognito lifecycle) leaves their equipment and firearm custody attributed to them", async () => {
  const before = await custody();
  assert.deepEqual(before.map((row) => row.id), [vest, radio, taser]);
  await as(admin, A, (client) => client.query("select public.update_department_member($1,$2,'S-44',null,null,null,false)", [A, separated]));
  assert.equal((await owner.query("select is_active from public.department_memberships where department_id=$1 and user_id=$2", [A, separated])).rows[0].is_active, false);
  // The import/Cognito path (prepare_cognito_membership_operation) after reactivation.
  await owner.query("update public.department_memberships set is_active=true, deactivated_at=null where department_id=$1 and user_id=$2", [A, separated]);
  await as(admin, A, (client) => client.query("select * from tracepoint_auth.prepare_cognito_membership_operation(gen_random_uuid(),'disable',$1,$2)", [A, separated]));
  assert.equal((await owner.query("select is_active from public.department_memberships where department_id=$1 and user_id=$2", [A, separated])).rows[0].is_active, false);
  assert.deepEqual(await custody(), before);
  for (const asset of [vest, radio, taser]) assert.deepEqual((await openHistory(asset)).map((row) => [row.assigned_user_id, row.returned_at]), [[separated, null]]);
  assert.equal((await owner.query("select count(*)::int n from public.firearm_assignments where firearm_id=$1 and assigned_to_user_id=$2 and returned_at is null", [firearm, separated])).rows[0].n, 1);
});

test("an equipment manager sees the separated holder's name under RLS, but not another agency's former member", async () => {
  const names = await as(quartermaster, A, async (client) => (await client.query("select id, full_name from public.profiles where id = any($1::uuid[]) order by full_name", [[separated, foreignOfficer]])).rows);
  assert.deepEqual(names, [{ id: separated, full_name: "Sam Separated" }]);
  const membership = await as(quartermaster, A, async (client) => (await client.query("select user_id, is_active from public.department_memberships where user_id=$1", [separated])).rows);
  assert.deepEqual(membership, [{ user_id: separated, is_active: false }]);
  // An officer without equipment or user permissions still cannot read the profile.
  assert.equal((await as(officer, A, (client) => client.query("select 1 from public.profiles where id=$1", [separated]))).rowCount, 0);
});

test("an item held by a separated member can be marked out of service, even when the update lists the unchanged holder", async () => {
  await as(quartermaster, A, (client) => client.query(
    "update public.equipment_assets set assigned_user_id=$2, assigned_vehicle_id=null, assigned_location=null, lifecycle_status='out_of_service', removal_reason='Not returned at separation', updated_by=$3 where id=$1",
    [vest, separated, quartermaster]));
  const row = (await owner.query("select assigned_user_id, lifecycle_status, removal_reason from public.equipment_assets where id=$1", [vest])).rows[0];
  assert.deepEqual(row, { assigned_user_id: separated, lifecycle_status: "out_of_service", removal_reason: "Not returned at separation" });
  // Still attributed: the open history row is unchanged.
  assert.deepEqual((await openHistory(vest)).map((entry) => [entry.assigned_user_id, entry.returned_at]), [[separated, null]]);
  const audit = (await owner.query("select actor_user_id, new_value->>'removal_reason' reason from public.audit_events where entity_id=$1 and new_value->>'lifecycle_status'='out_of_service'", [vest])).rows;
  assert.deepEqual(audit, [{ actor_user_id: quartermaster, reason: "Not returned at separation" }]);
});

test("removing an item held by a separated member closes the assignment with the removal reason", async () => {
  await as(quartermaster, A, (client) => client.query(
    "update public.equipment_assets set assigned_user_id=null, lifecycle_status='removed', removal_reason='Lost - not returned', removed_at=now(), removed_by=$2, updated_by=$2 where id=$1",
    [radio, quartermaster]));
  const history = await openHistory(radio);
  assert.equal(history.length, 1);
  assert.ok(history[0].returned_at);
  assert.equal(history[0].return_notes, "Equipment removed from active inventory: Lost - not returned");
  assert.equal((await owner.query("select returned_by from public.equipment_asset_assignments where equipment_asset_id=$1", [radio])).rows[0].returned_by, quartermaster);
});

test("returning an item from a separated member closes the assignment as returned", async () => {
  await as(quartermaster, A, (client) => client.query("update public.equipment_assets set assigned_user_id=null, assigned_location='Quartermaster', updated_by=$2 where id=$1", [taser, quartermaster]));
  const history = await openHistory(taser);
  assert.equal(history.length, 1);
  assert.ok(history[0].returned_at);
  assert.equal(history[0].return_notes, "Equipment returned / unassigned");
});

test("a new assignment to a separated member is still refused", async () => {
  await assert.rejects(
    as(quartermaster, A, (client) => client.query("update public.equipment_assets set assigned_user_id=$2, updated_by=$3 where id=$1", [spare, separated, quartermaster])),
    /Assigned officer must be an active member/);
  await assert.rejects(
    as(quartermaster, A, (client) => client.query("insert into public.equipment_assets(department_id,equipment_type_id,assigned_user_id,created_by,updated_by) values($1,$2,$3,$4,$4)", [A, typeId, separated, quartermaster])),
    /Assigned officer must be an active member/);
  // Moving the separated holder's item to another officer is a new assignment to an active member.
  await as(quartermaster, A, (client) => client.query("update public.equipment_assets set assigned_user_id=$2, lifecycle_status='active', removal_reason=null, updated_by=$3 where id=$1", [vest, officer, quartermaster]));
  assert.deepEqual((await openHistory(vest)).map((entry) => [entry.assigned_user_id, entry.returned_at === null, entry.return_notes]), [[separated, false, "Equipment reassigned"], [officer, true, null]]);
});

test("an item on a retired vehicle can change status, but nothing new can be placed on that vehicle", async () => {
  await owner.query("update public.fleet_vehicles set status='Retired' where id=$1", [vehicle]);
  await as(quartermaster, A, (client) => client.query("update public.equipment_assets set assigned_vehicle_id=$2, lifecycle_status='out_of_service', removal_reason='Vehicle retired', updated_by=$3 where id=$1", [aed, vehicle, quartermaster]));
  assert.equal((await owner.query("select lifecycle_status from public.equipment_assets where id=$1", [aed])).rows[0].lifecycle_status, "out_of_service");
  await assert.rejects(
    as(quartermaster, A, (client) => client.query("update public.equipment_assets set assigned_vehicle_id=$2, updated_by=$3 where id=$1", [spare, vehicle, quartermaster])),
    /Assigned vehicle must belong to the equipment agency/);
});

test("migration 049 is repeatable", async () => {
  const sql = await readFile("database/aws/059_equipment_separated_holder.sql", "utf8");
  await owner.query(sql);
  await owner.query(sql);
  assert.equal((await owner.query("select count(*)::int n from pg_policies where tablename='profiles' and policyname='profiles_select_self_or_department_admin'")).rows[0].n, 1);
});

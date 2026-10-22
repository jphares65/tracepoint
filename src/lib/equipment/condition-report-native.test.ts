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

// D-2: an officer's equipment condition report on the full AWS-native schema, in
// the request context withPostgresAuthorization sets (tracepoint_runtime ->
// authenticated). Before 066 the custody route's direct update matched no row.
const A = "dddddddd-0000-4000-8000-00000000000a", B = "dddddddd-0000-4000-8000-00000000000b";
const quartermaster = "a0000000-0000-4000-8000-0000000000e1", officer = "a0000000-0000-4000-8000-0000000000c1";
const otherOfficer = "a0000000-0000-4000-8000-0000000000c2", foreignOfficer = "b0000000-0000-4000-8000-0000000000c1";
const typeId = "e7000000-0000-4000-8000-00000000000a";
const held = "ea000000-0000-4000-8000-000000000001", pool = "ea000000-0000-4000-8000-000000000002";
const othersItem = "ea000000-0000-4000-8000-000000000003", racing = "ea000000-0000-4000-8000-000000000004";
let server: EmbeddedPostgres, owner: pg.Pool, runtime: pg.Pool, directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-condition-report-"));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "synthetic-local-only", port, persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {} });
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
  runtime = new pg.Pool({ host: "127.0.0.1", port, user: "tracepoint_runtime", password: "synthetic-runtime-only", database: "postgres" });
  for (const [id, name] of [[quartermaster, "Quinn Quartermaster"], [officer, "Olive Officer"], [otherOfficer, "Oscar Officer"], [foreignOfficer, "Foreign Officer"]]) {
    await owner.query("insert into auth.users(id,email) values($1,$2)", [id, `${id.slice(-2)}@example.test`]);
    await owner.query("insert into public.profiles(id,full_name,email) values($1,$2,$3) on conflict(id) do update set full_name=excluded.full_name", [id, name, `${id.slice(-2)}@example.test`]);
  }
  await owner.query("insert into public.departments(id,name,short_name,slug,created_by) values($1,'Dept A','DA','dept-a',$3),($2,'Dept B','DB','dept-b',$4)", [A, B, quartermaster, foreignOfficer]);
  await owner.query(`insert into public.department_memberships(department_id,user_id,badge_number,is_active,activation_status)
    values($1,$3,'Q-1',true,'activated'),($1,$4,'O-1',true,'activated'),($1,$5,'O-2',true,'activated'),($2,$6,'F-1',true,'activated')`, [A, B, quartermaster, officer, otherOfficer, foreignOfficer]);
  await owner.query(`insert into public.department_membership_roles(department_id,user_id,role_code)
    values($1,$3,'armorer'),($1,$4,'officer'),($1,$5,'officer'),($2,$6,'officer')`, [A, B, quartermaster, officer, otherOfficer, foreignOfficer]);
  for (const department of [A, B]) {
    await owner.query("insert into public.department_features(department_id,feature_code,is_enabled) values($1,'equipment_readiness',true) on conflict (department_id,feature_code) do update set is_enabled=true", [department]);
  }
  await owner.query("insert into public.equipment_types(id,department_id,name) values($1,$2,'Radio')", [typeId, A]);
  for (const [id, holder] of [[held, officer], [othersItem, otherOfficer], [racing, officer]]) {
    await owner.query("insert into public.equipment_assets(id,department_id,equipment_type_id,serial_number,assigned_user_id,created_by,updated_by) values($1,$2,$3,$5,$4,$6,$6)", [id, A, typeId, holder, `SN-${id.slice(-2)}`, quartermaster]);
  }
  await owner.query("insert into public.equipment_assets(id,department_id,equipment_type_id,serial_number,created_by,updated_by) values($1,$2,$3,'SN-pool',$4,$4)", [pool, A, typeId, quartermaster]);
});

after(async () => { await runtime?.end(); await owner?.end(); await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

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
const report = (subject: string, department: string, asset: string, expectedNotes: string | null, condition = "damaged") =>
  as(subject, department, async (client) => (await client.query("select public.report_equipment_condition($1,$2,$3,$4,$5) as item", [department, asset, condition, "Cracked antenna", expectedNotes])).rows[0].item);
const stored = async (asset: string) => (await owner.query("select lifecycle_status, notes, assigned_user_id from public.equipment_assets where id=$1", [asset])).rows[0];
const reportEvents = async (asset: string) => (await owner.query("select actor_user_id, entity_id, new_value->>'condition' as condition from public.audit_events where action='report' and entity_type='equipment_asset' and entity_id=$1", [asset])).rows;

test("the route's former direct update stores nothing for an officer (the D-2 defect)", async () => {
  const result = await as(officer, A, (client) => client.query(
    "update public.equipment_assets set lifecycle_status='out_of_service', notes='x', updated_by=$1 where department_id=$2 and id=$3 and lifecycle_status='active' and notes is null and assigned_user_id=$1",
    [officer, A, held]));
  assert.equal(result.rowCount, 0);
  assert.equal((await stored(held)).lifecycle_status, "active");
});

test("the custodian's report takes the item out of service, keeps custody and writes one audit event", async () => {
  const item = await report(officer, A, held, null);
  assert.equal(item.lifecycle_status, "out_of_service");
  const row = await stored(held);
  assert.equal(row.lifecycle_status, "out_of_service");
  assert.equal(row.assigned_user_id, officer, "reporting is not a custody transfer");
  assert.match(row.notes, new RegExp(`\\[condition=damaged\\]\\[reported_by=${officer}\\] Cracked antenna$`));
  assert.deepEqual(await reportEvents(held), [{ actor_user_id: officer, entity_id: held, condition: "damaged" }]);
});

test("any member may report available pool equipment", async () => {
  const item = await report(officer, A, pool, null, "missing_parts");
  assert.equal(item.lifecycle_status, "out_of_service");
  assert.equal((await stored(pool)).lifecycle_status, "out_of_service");
  assert.equal((await reportEvents(pool)).length, 1);
});

test("an officer cannot report equipment another officer holds", async () => {
  await assert.rejects(report(officer, A, othersItem, null), (error: { code?: string }) => error.code === "42501");
  assert.equal((await stored(othersItem)).lifecycle_status, "active");
  assert.deepEqual(await reportEvents(othersItem), []);
});

test("another agency's member cannot report this agency's equipment", async () => {
  await assert.rejects(report(foreignOfficer, A, othersItem, null), (error: { code?: string }) => error.code === "42501");
  // Claiming their own agency does not reach an asset of another agency.
  assert.equal(await report(foreignOfficer, B, othersItem, null), null);
  assert.equal((await stored(othersItem)).lifecycle_status, "active");
});

test("a report based on notes that changed since they were read writes nothing", async () => {
  await owner.query("update public.equipment_assets set notes='Inspected by armorer' where id=$1", [racing]);
  assert.equal(await report(officer, A, racing, null), null);
  const row = await stored(racing);
  assert.equal(row.lifecycle_status, "active");
  assert.equal(row.notes, "Inspected by armorer");
  assert.deepEqual(await reportEvents(racing), []);
  // With the current notes the report is appended below them.
  await report(officer, A, racing, "Inspected by armorer");
  assert.match((await stored(racing)).notes, /^Inspected by armorer\n\[/);
});

test("an item already out of service is not reported again", async () => {
  assert.equal(await report(officer, A, held, (await stored(held)).notes), null);
  assert.equal((await reportEvents(held)).length, 1);
});

test("an invalid condition or an empty description is refused", async () => {
  await assert.rejects(report(otherOfficer, A, othersItem, null, "serviceable"), (error: { code?: string }) => error.code === "22023");
  await assert.rejects(as(otherOfficer, A, (client) => client.query("select public.report_equipment_condition($1,$2,'damaged','   ',null)", [A, othersItem])), (error: { code?: string }) => error.code === "22023");
  assert.equal((await stored(othersItem)).lifecycle_status, "active");
});

test("the function is not callable outside an authenticated request", async () => {
  const privileges = (await owner.query("select has_function_privilege('tracepoint_runtime', 'public.report_equipment_condition(uuid,uuid,text,text,text)', 'execute') as runtime, has_function_privilege('anon', 'public.report_equipment_condition(uuid,uuid,text,text,text)', 'execute') as anon")).rows[0];
  assert.deepEqual(privileges, { runtime: false, anon: false });
});

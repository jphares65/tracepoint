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

// AT-1 on the full AWS-native schema (001-068): the safety-hold guard refuses a person's status
// change whole (nothing of the update is written), whatever route, page state or request ordering
// sent it; automatic readiness updates are still kept Out of Service as before (057).
const A = "a7100000-0000-4000-8000-00000000000a", manager = "a7100000-0000-4000-8000-0000000000a1";
let server: EmbeddedPostgres, owner: pg.Pool, directory: string, unit = 0;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-manual-status-hold-"));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "synthetic-local-only", port, persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  owner = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "synthetic-local-only", database: "postgres", max: 4 });
  await owner.query(supabasePrerequisites);
  for (const folder of ["supabase/migrations", "database/aws"]) {
    for (const file of (await readdir(folder)).filter(isAwsNativeSchemaFile).sort()) {
      await owner.query((await readFile(path.join(folder, file), "utf8")).replace(/^﻿/, ""));
    }
  }
  await owner.query("insert into auth.users(id,email) values($1,'a1@example.test')", [manager]);
  await owner.query("insert into public.departments(id,name,short_name,slug,created_by) values($1,'AT-1','A','at1-a',$2)", [A, manager]);
});

after(async () => { await owner?.end(); await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

async function vehicle(status = "Available") {
  unit += 1;
  return String((await owner.query("insert into public.fleet_vehicles(department_id,unit_number,status,status_override_active,status_reason) values($1,$2,$3,false,'Held') returning id", [A, `AT1-${unit}`, status])).rows[0].id);
}
const criticalOrder = async (vehicleId: string, status = "Open") => String((await owner.query("insert into public.fleet_work_orders(department_id,vehicle_id,title,priority,status,affects_availability) values($1,$2,'Brakes','Critical',$3,true) returning id", [A, vehicleId, status])).rows[0].id);
const row = async (vehicleId: string) => (await owner.query("select status,status_override_active,status_reason,comments from public.fleet_vehicles where id=$1", [vehicleId])).rows[0];
const audits = async (vehicleId: string) => (await owner.query("select action from public.audit_events where entity_id=$1 and action like 'fleet_%' order by created_at", [vehicleId])).rows.map((r) => r.action);
/** The manual-status routes' update: a status with the override set (or cleared), a reason and other fields. */
const manual = (client: pg.Pool | pg.PoolClient, vehicleId: string, status: string, override = true) =>
  client.query("update public.fleet_vehicles set status=$2,status_override_active=$3,status_reason='manager says it is fine',comments='should not be saved',updated_at=now() where id=$1", [vehicleId, status, override]);
/** The readiness refresh's update: status only. */
const automatic = (vehicleId: string, status: string) => owner.query("update public.fleet_vehicles set status=$2,updated_at=now() where id=$1", [vehicleId, status]);
const refused = (error: { code?: string }) => error.code === "55000";

test("acceptance F8: a manual Available or Attention under a hold is refused and writes nothing", async () => {
  for (const status of ["Available", "Attention"]) {
    for (const override of [true, false]) {
      const id = await vehicle("Out of Service");
      if (!override) await owner.query("update public.fleet_vehicles set status_override_active=true where id=$1", [id]);
      await criticalOrder(id);
      const before = await row(id);
      await assert.rejects(manual(owner, id, status, override), refused, `${status} override=${override}`);
      assert.deepEqual(await row(id), before, "nothing of the refused update is written");
      assert.deepEqual(await audits(id), []);
    }
  }
});

test("automatic readiness updates are kept Out of Service and audited as before (057)", async () => {
  const id = await vehicle("Out of Service");
  await criticalOrder(id);
  await automatic(id, "Available");
  assert.deepEqual(await row(id), { status: "Out of Service", status_override_active: false, status_reason: "Held", comments: null });
  assert.deepEqual(await audits(id), ["fleet_safety_hold_status_kept"]);
});

test("acceptance F10-F13: after the work order is completed and the hold cleared, no leftover override keeps the vehicle out of service", async () => {
  const id = await vehicle("Out of Service");
  const order = await criticalOrder(id);
  await assert.rejects(manual(owner, id, "Available"), refused);
  await owner.query("update public.fleet_work_orders set status='Completed' where id=$1", [order]);
  await owner.query("update public.fleet_vehicles set safety_hold_cleared_at=now()+interval '1 second' where id=$1", [id]);
  await automatic(id, "Available");
  assert.deepEqual(await row(id), { status: "Available", status_override_active: false, status_reason: "Held", comments: null });
  assert.equal((await manual(owner, id, "Attention")).rowCount, 1, "a manual status after release is an ordinary override");
});

test("a manual change waiting on a hold being recorded is refused once the hold commits", async () => {
  const id = await vehicle("Available");
  const recording = await owner.connect();
  try {
    // The inspection/work-order path: the critical work order and the vehicle's readiness in one uncommitted transaction.
    await recording.query("begin");
    await recording.query("insert into public.fleet_work_orders(department_id,vehicle_id,title,priority,status,affects_availability) values($1,$2,'Brakes','Critical','Open',true)", [A, id]);
    await recording.query("update public.fleet_vehicles set status='Out of Service' where id=$1", [id]);
    const change = manual(owner, id, "Available").then(() => "applied", (error: { code?: string }) => error.code ?? "failed");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await recording.query("commit");
    assert.equal(await change, "55000");
  } finally { recording.release(); }
  assert.deepEqual(await row(id), { status: "Out of Service", status_override_active: false, status_reason: "Held", comments: null });
});

test("068 flags vehicles the defect already left overridden Out of Service for review, once, without changing them", async () => {
  const id = await vehicle("Out of Service");
  await owner.query("update public.fleet_vehicles set status_override_active=true,status_reason='manager says it is fine' where id=$1", [id]);
  await owner.query("insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,details) values($1,$2,'fleet_safety_hold_status_kept','fleet_vehicle',$3,'kept',jsonb_build_object('attempted_status','Available'))", [A, manager, id]);
  const clean = await vehicle("Out of Service");
  const migration = await readFile("database/aws/068_fleet_manual_status_under_safety_hold.sql", "utf8");
  await owner.query(migration);
  await owner.query(migration);
  assert.deepEqual(await audits(id), ["fleet_safety_hold_status_kept", "fleet_status_override_review"]);
  assert.deepEqual((await row(id)).status_override_active, true, "the override is left for a manager to decide");
  assert.deepEqual(await audits(clean), []);
});

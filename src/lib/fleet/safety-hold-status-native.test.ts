/* eslint-disable @typescript-eslint/no-explicit-any -- route handlers run against a stubbed session resolver */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
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

// AT-1 on the full AWS-native schema: both manual-status PATCH routes run unchanged through the runtime's
// PostgresDataClient (tracepoint_runtime, row policies, database/aws/057 and 068). A direct request cannot make a
// held vehicle Available or Attention: it is refused with 409 (safety_hold_active), the vehicle row is unchanged and
// only the refusal is audited. A hold created between the route's check and its write is refused whole by the
// database (068, SQLSTATE 55000), and a manual update that bypasses the routes is refused the same way.
const require = createRequire(import.meta.url);
const stub = (file: string, exports: Record<string, unknown>) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } as any; };
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__safetyHoldAccess,
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  hasServerFeature: (context: any, code: string) => (context.enabledFeatures ?? []).includes(code),
  featureDisabledResponse: (name = "This TracePoint module") => Response.json({ error: `${name} is not enabled for this agency.` }, { status: 403 }),
  hasAnyServerPermission: (context: any, codes: string[]) => codes.some((code) => context.permissions.includes(code)),
  permissionDeniedResponse: (error: string) => Response.json({ error }, { status: 403 }),
});

const A = "a0000000-0000-4000-8000-00000000000a", B = "b0000000-0000-4000-8000-00000000000b";
const manager = "a1000000-0000-4000-8000-000000000001", officer = "a1000000-0000-4000-8000-000000000002", foreignManager = "b1000000-0000-4000-8000-000000000001";
const held = "a3000000-0000-4000-8000-000000000001", raced = "a3000000-0000-4000-8000-000000000002";
let server: EmbeddedPostgres, owner: pg.Pool, runtime: pg.Pool, directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-safety-hold-status-"));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "synthetic-local-only", port, persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  owner = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "synthetic-local-only", database: "postgres" });
  await owner.query(supabasePrerequisites);
  for (const folder of ["supabase/migrations", "database/aws"]) {
    for (const file of (await readdir(folder)).filter(isAwsNativeSchemaFile).sort()) await owner.query((await readFile(path.join(folder, file), "utf8")).replace(/^﻿/, ""));
  }
  await owner.query("alter role tracepoint_runtime login password 'synthetic-runtime-only'");
  runtime = new pg.Pool({ host: "127.0.0.1", port, user: "tracepoint_runtime", password: "synthetic-runtime-only", database: "postgres" });
  for (const [id, name] of [[manager, "manager"], [officer, "officer"], [foreignManager, "foreign"]]) {
    await owner.query("insert into auth.users(id,email) values($1,$2)", [id, `${name}@example.test`]);
    await owner.query("insert into public.profiles(id,full_name,email) values($1,$2,$3) on conflict(id) do update set full_name=excluded.full_name", [id, name, `${name}@example.test`]);
  }
  for (const [id, slug] of [[A, "dept-a"], [B, "dept-b"]]) await owner.query("insert into public.departments(id,name,short_name,slug,created_by) values($1,$2,$2,$2,$3)", [id, slug, manager]);
  for (const [dept, user, role] of [[A, manager, "fleet_manager"], [A, officer, "officer"], [B, foreignManager, "fleet_manager"]]) {
    await owner.query("insert into public.department_memberships(department_id,user_id,is_active,activation_status) values($1,$2,true,'activated')", [dept, user]);
    await owner.query("insert into public.department_membership_roles(department_id,user_id,role_code) values($1,$2,$3)", [dept, user, role]);
  }
  await owner.query("insert into public.department_features(department_id,feature_code,is_enabled) values($1,'fleet',true),($2,'fleet',true) on conflict (department_id, feature_code) do update set is_enabled=true", [A, B]);
  await owner.query("insert into public.fleet_vehicles(id,department_id,unit_number,status,status_override_active,status_reason) values($1,$3,'101','Out of Service',false,'Held'),($2,$3,'102','Out of Service',false,'Held')", [held, raced, A]);
  // The held vehicle's critical work order is open; the raced vehicle's hold is created during the request.
  await owner.query("insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,priority,status,affects_availability) values($1,$2,'Repair','Brakes','Critical','Open',true)", [A, held]);
});

after(async () => { await runtime?.end(); await owner?.end(); await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

const signIn = (subject: string, department: string, permissions: string[], admin: any = new PostgresDataClient(runtime as never, subject, department)) => {
  (globalThis as any).__safetyHoldAccess = { ok: true, context: { admin, db: admin, authDb: admin, departmentId: department, userId: subject, user: { id: subject }, permissions, roleCodes: [], isSuperAdmin: false, isSupportMode: false, enabledFeatures: ["fleet"] } };
};
const routes = async () => {
  const { NextRequest } = await import("next/server");
  const json = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const vehicleRoute = await import("../../app/api/fleet/vehicles/[vehicleId]/route.ts");
  const listRoute = await import("../../app/api/fleet/vehicles/route.ts");
  return {
    vehicle: (id: string, body: Record<string, unknown>) => vehicleRoute.PATCH(json(`/api/fleet/vehicles/${id}`, body), { params: Promise.resolve({ vehicleId: id }) as any }),
    list: (id: string, body: Record<string, unknown>) => listRoute.PATCH(json("/api/fleet/vehicles", { id, ...body })),
  };
};
const row = async (id: string) => (await owner.query("select status, status_override_active, status_reason, safety_hold_cleared_at from public.fleet_vehicles where id=$1", [id])).rows[0];
const vehicleRow = async (id: string) => (await owner.query("select to_jsonb(v) as vehicle from public.fleet_vehicles v where id=$1", [id])).rows[0].vehicle;
const audits = async (id: string) => (await owner.query("select department_id, actor_user_id, action, details from public.audit_events where entity_id=$1 order by id", [id])).rows;
const reset = (id: string) => owner.query("update public.fleet_vehicles set status='Out of Service', status_override_active=false, status_reason='Held' where id=$1", [id]);
const unchanged = { status: "Out of Service", status_override_active: false, status_reason: "Held", safety_hold_cleared_at: null };

test("AT-1 a direct PATCH cannot make a held vehicle Available or Attention through either route; only the refusal is recorded", async () => {
  const send = await routes();
  await reset(held);
  signIn(manager, A, ["view_fleet", "manage_fleet"]);
  const before = await vehicleRow(held);
  const auditsBefore = (await audits(held)).length;
  let refusals = 0;
  for (const status of ["Available", "Attention"]) {
    for (const [name, patch] of [["vehicle", send.vehicle], ["list", send.list]] as const) {
      const response = await patch(held, { status, reason: "manager says it is fine" });
      const body = await response.json();
      assert.equal(response.status, 409, `${name} ${status} is refused`);
      assert.equal(body.code, "safety_hold_active");
      assert.match(body.error, /under a safety hold and was not changed/);
      assert.equal(body.safetyHold?.source, "work_order", `${name} ${status} names the hold`);
      assert.deepEqual(await vehicleRow(held), before, `${name} ${status} left every vehicle column (status, override, reason, hold, updated_at) as it was`);
      refusals += 1;
      const added = (await audits(held)).slice(auditsBefore);
      assert.equal(added.length, refusals, `${name} ${status} recorded exactly one audit entry`);
      const last = added.at(-1);
      assert.equal(last.action, "fleet_safety_hold_status_refused");
      assert.equal(last.department_id, A, "the refusal is recorded in the vehicle's own agency");
      assert.equal(last.actor_user_id, manager);
      assert.equal(last.details.attempted_status, status);
    }
  }
  assert.ok((await audits(held)).every((entry) => entry.action !== "fleet_vehicle_updated"), "no update was recorded for the held vehicle");
});

test("AT-1 a hold created between the route's check and its write is refused whole by the database (068)", async () => {
  const send = await routes();
  for (const [name, patch] of [["vehicle", send.vehicle], ["list", send.list]] as const) {
    await owner.query("delete from public.fleet_work_orders where vehicle_id=$1", [raced]);
    await reset(raced);
    const before = await vehicleRow(raced);
    const auditsBefore = (await audits(raced)).length;
    // The critical work order is committed by another session after the route read the vehicle, just before its update runs.
    const client = new PostgresDataClient(runtime as never, manager, A);
    const racing: any = Object.create(client);
    let raced_ = false;
    racing.from = (table: string) => {
      const builder: any = client.from(table);
      if (table !== "fleet_vehicles") return builder;
      const update = builder.update.bind(builder);
      builder.update = (value: Record<string, unknown>) => {
        const result = update(value);
        if (value.status !== "Available") return result;
        raced_ = true;
        const then = result.then.bind(result);
        result.then = (resolve: any, reject: any) => owner.query("insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,priority,status,affects_availability) values($1,$2,'Repair','Steering','Critical','Open',true)", [A, raced]).then(() => then(resolve, reject), reject);
        return result;
      };
      return builder;
    };
    signIn(manager, A, ["view_fleet", "manage_fleet"], racing);
    const response = await patch(raced, { status: "Available", reason: "race with a new critical defect" });
    assert.ok(raced_, `${name} reached its write after the check`);
    const body = await response.json();
    assert.equal(response.status, 409, `${name} reports the database refusal`);
    assert.equal(body.code, "safety_hold_active");
    assert.deepEqual(await vehicleRow(raced), before, `${name} wrote nothing: status, override, reason and updated_at are unchanged`);
    const added = (await audits(raced)).slice(auditsBefore);
    assert.deepEqual(added.map((entry) => entry.action), ["fleet_safety_hold_status_refused"], `${name} recorded only the refusal`);
  }
});

test("AT-1 a manual status update that bypasses the routes is refused by the database, and an automatic one is kept Out of Service", async () => {
  await reset(held);
  const client = new PostgresDataClient(runtime as never, manager, A);
  const before = await vehicleRow(held);
  const manual = await client.from("fleet_vehicles").update({ status: "Available", status_override_active: true, status_reason: "direct write" }).eq("department_id", A).eq("id", held).select("*");
  assert.equal(String((manual as any).error?.code), "55000", "068 refuses a manual Available while the hold applies");
  assert.deepEqual(await vehicleRow(held), before, "nothing of the refused update is written");
  const auditsBefore = (await audits(held)).length;
  const automatic = await client.from("fleet_vehicles").update({ status: "Available" }).eq("department_id", A).eq("id", held).select("status");
  assert.equal((automatic as any).error, null, "an automatic status update is not refused");
  assert.equal((await row(held)).status, "Out of Service", "057 keeps the held vehicle Out of Service");
  const kept = (await audits(held)).slice(auditsBefore).filter((entry) => entry.action === "fleet_safety_hold_status_kept");
  assert.equal(kept.length, 1, "the kept status is audited once");
  assert.equal(kept[0].details.attempted_status, "Available");
});

test("AT-1 another agency's manager and a member without fleet management cannot change the held vehicle", async () => {
  const send = await routes();
  await reset(held);
  signIn(foreignManager, B, ["view_fleet", "manage_fleet"]);
  for (const patch of [send.vehicle, send.list]) {
    const response = await patch(held, { status: "Available", reason: "not my agency" });
    assert.ok([403, 404].includes(response.status), `foreign manager answered ${response.status}`);
  }
  signIn(officer, A, ["view_fleet"]);
  for (const patch of [send.vehicle, send.list]) assert.equal((await patch(held, { status: "Available", reason: "not a manager" })).status, 403);
  assert.deepEqual(await row(held), unchanged);
});

test("AT-1 a stricter status stays allowed on a held vehicle", async () => {
  const send = await routes();
  await reset(held);
  signIn(manager, A, ["view_fleet", "manage_fleet"]);
  assert.equal((await send.vehicle(held, { status: "Maintenance", reason: "in the shop" })).status, 200);
  assert.equal((await row(held)).status, "Maintenance");
});

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { PostgresDataClient } from "../database/postgres-data-client.ts";

// 056: one request, one record (D-65, C-07), and the recipient directory
// (D-62, D-63), on real PostgreSQL with the 035-037 schema underneath.
const require = createRequire(import.meta.url);
const { default: EmbeddedPostgres } = require("embedded-postgres") as {
  default: new (input: Record<string, unknown>) => {
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    getPgClient(): {
      connect(): Promise<void>;
      end(): Promise<void>;
      query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    };
  };
};
let directory = "";
let database: InstanceType<typeof EmbeddedPostgres>;
let client: ReturnType<InstanceType<typeof EmbeddedPostgres>["getPgClient"]>;

const department = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002",
  user = "20000000-0000-4000-8000-000000000001",
  colleague = "20000000-0000-4000-8000-000000000002",
  former = "20000000-0000-4000-8000-000000000003",
  outsider = "20000000-0000-4000-8000-000000000009",
  pooled = "30000000-0000-4000-8000-000000000001",
  gloves = "30000000-0000-4000-8000-000000000002",
  supply = "40000000-0000-4000-8000-000000000001",
  car = "40000000-0000-4000-8000-000000000002",
  vehicle = "50000000-0000-4000-8000-000000000001",
  retired = "50000000-0000-4000-8000-000000000002",
  foreignVehicle = "50000000-0000-4000-8000-000000000003";
const key = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function dataClient(subject: string, tenant = department) {
  const pool = { connect: async () => ({ query: client.query.bind(client), release() {} }) };
  return new PostgresDataClient(pool as never, subject, tenant);
}
function row(data: unknown) {
  return (Array.isArray(data) ? data[0] : data) as { id: string };
}
async function scalar(sql: string, values: unknown[] = []) {
  return Object.values((await client.query(sql, values)).rows[0])[0];
}
async function onHand(item: string, location: string) {
  return scalar("select on_hand_quantity::text from public.inventory_balances where inventory_item_id=$1 and inventory_location_id=$2", [item, location]);
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-inventory-idempotency-"));
  database = new EmbeddedPostgres({
    databaseDir: directory, user: "postgres", password: "local-only", port: await localPostgresPort(),
    persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {}, onError: () => {},
  });
  await database.initialise();
  await database.start();
  client = database.getPgClient();
  await client.connect();
  await client.query(`create extension if not exists pgcrypto; create role anon nologin; create role authenticated nologin; create role service_role nologin; create role tracepoint_runtime nologin; create schema tracepoint_auth;
    create function tracepoint_auth.subject_id() returns uuid language sql stable as $$select nullif(current_setting('tracepoint.subject_id',true),'')::uuid$$;
    create function tracepoint_auth.department_id() returns uuid language sql stable as $$select nullif(current_setting('tracepoint.department_id',true),'')::uuid$$;
    create table public.departments(id uuid primary key); create table public.profiles(id uuid primary key, full_name text, email text); create table public.permissions(code text primary key,display_name text,description text);
    create table public.department_memberships(department_id uuid,user_id uuid,is_active boolean,rank_title text,badge_number text,unit_name text,primary key(department_id,user_id));
    create table public.fleet_vehicles(id uuid primary key,department_id uuid,status text,unit_number text,make text,model text,license_plate text);
    create table public.firearm_inspections(id uuid primary key default gen_random_uuid(),department_id uuid not null,firearm_id uuid);
    create function public.is_department_member(p_department_id uuid) returns boolean language sql stable as $$select exists(select 1 from public.department_memberships where department_id=p_department_id and user_id=tracepoint_auth.subject_id() and is_active)$$;
    create function public.has_department_permission(p_department_id uuid,p_permission_code text) returns boolean language sql stable as $$select public.is_department_member(p_department_id)$$;`);
  for (const file of ["035_inventory_phase1.sql", "036_inventory_checkout_phase2a.sql", "037_inventory_management_runtime_grants.sql", "056_inventory_idempotency_and_recipients.sql"]) {
    const sql = await readFile(`database/aws/${file}`, "utf8");
    await client.query(sql);
    await client.query(sql);
  }
  await client.query("grant usage on schema public, tracepoint_auth to authenticated; grant select on public.department_memberships to authenticated;");
  await client.query("insert into public.departments values($1),($2)", [department, other]);
  await client.query("insert into public.profiles(id,full_name,email) values($1,'Dana Cole','dana@example.test'),($2,'Lee Park','lee@example.test'),($3,'Sam Ruiz',null),($4,'Out Sider',null)", [user, colleague, former, outsider]);
  await client.query("insert into public.department_memberships values($1,$2,true,'Sgt','101','Patrol'),($1,$3,true,null,'202',null),($1,$4,false,null,null,null),($5,$6,true,null,null,null)", [department, user, colleague, former, other, outsider]);
  await client.query("insert into public.fleet_vehicles values($1,$2,'Available','12','Ford','Explorer','ABC123'),($3,$2,'Retired','7',null,null,null),($4,$5,'Available','99',null,null,null)", [vehicle, department, retired, foreignVehicle, other]);
  await client.query("insert into public.inventory_items(id,department_id,name,tracking_mode,created_by,updated_by) values($1,$3,'Radios','pooled',$4,$4),($2,$3,'Gloves','consumable',$4,$4)", [pooled, gloves, department, user]);
  await client.query("insert into public.inventory_locations(id,department_id,name,created_by,updated_by) values($1,$3,'Supply room',$4,$4),($2,$3,'Car 12',$4,$4)", [supply, car, department, user]);
  const actor = dataClient(user);
  for (const item of [pooled, gloves]) {
    const received = await actor.rpc("record_inventory_transaction", { p_item_id: item, p_transaction_type: "receive", p_quantity: 10, p_source_location_id: null, p_destination_location_id: supply, p_reason: "delivery", p_reference: null });
    assert.equal(received.error, null);
  }
});
after(async () => {
  await client?.end().catch(() => undefined);
  await database?.stop().catch(() => undefined);
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
});

test("a replayed checkout returns the first checkout and moves stock once", async () => {
  const actor = dataClient(user);
  const args = { p_item_id: pooled, p_location_id: supply, p_recipient_type: "officer", p_recipient_user_id: colleague, p_recipient_unit: null, p_recipient_vehicle_id: null, p_quantity: 2, p_due_at: null, p_reason: "shift", p_reference: null, p_idempotency_key: key(1) };
  const first = await actor.rpc("checkout_inventory", args);
  const second = await actor.rpc("checkout_inventory", args);
  assert.equal(first.error, null);
  assert.equal(second.error, null);
  assert.equal(row(second.data).id, row(first.data).id);
  assert.equal(await scalar("select count(*)::int from public.inventory_checkouts where idempotency_key=$1", [key(1)]), 1);
  assert.equal(await scalar("select count(*)::int from public.inventory_transactions where inventory_item_id=$1 and transaction_type='checkout'", [pooled]), 1);
  assert.equal(await onHand(pooled, supply), "8.000");
  const reused = await actor.rpc("checkout_inventory", { ...args, p_quantity: 3 });
  assert.equal(reused.error?.code, "23505");
  const otherActor = await dataClient(colleague).rpc("checkout_inventory", args);
  assert.equal(otherActor.error?.code, "23505");
  assert.equal(await onHand(pooled, supply), "8.000");
});

test("a replayed return records one return and restores stock once", async () => {
  const actor = dataClient(user);
  const checkout = await actor.rpc("checkout_inventory", { p_item_id: pooled, p_location_id: supply, p_recipient_type: "vehicle", p_recipient_user_id: null, p_recipient_unit: null, p_recipient_vehicle_id: vehicle, p_quantity: 4, p_due_at: null, p_reason: null, p_reference: null, p_idempotency_key: key(2) });
  assert.equal(checkout.error, null);
  const id = row(checkout.data).id;
  const args = { p_checkout_id: id, p_quantity: 1, p_reason: "partial", p_reference: null, p_idempotency_key: key(3) };
  assert.equal((await actor.rpc("return_inventory_checkout", args)).error, null);
  assert.equal((await actor.rpc("return_inventory_checkout", args)).error, null);
  assert.equal(await scalar("select count(*)::int from public.inventory_checkout_returns where inventory_checkout_id=$1", [id]), 1);
  assert.equal(await scalar("select count(*)::int from public.inventory_transactions where inventory_item_id=$1 and transaction_type='checkin'", [pooled]), 1);
  assert.equal(await onHand(pooled, supply), "5.000");
  const reused = await actor.rpc("return_inventory_checkout", { ...args, p_quantity: 2 });
  assert.equal(reused.error?.code, "23505");
});

test("a replayed consumable issue lowers on-hand once and keeps its reason", async () => {
  const actor = dataClient(user);
  const args = { p_item_id: gloves, p_transaction_type: "adjust", p_quantity: -3, p_source_location_id: supply, p_destination_location_id: null, p_reason: "Issued to patrol", p_reference: null, p_idempotency_key: key(4) };
  const first = await actor.rpc("record_inventory_transaction", args);
  const second = await actor.rpc("record_inventory_transaction", args);
  assert.equal(first.error, null);
  assert.equal(row(second.data).id, row(first.data).id);
  assert.equal(await onHand(gloves, supply), "7.000");
  assert.deepEqual((await client.query("select transaction_type,quantity::text,reason from public.inventory_transactions where idempotency_key=$1", [key(4)])).rows, [{ transaction_type: "adjust", quantity: "-3.000", reason: "Issued to patrol" }]);
  const reused = await actor.rpc("record_inventory_transaction", { ...args, p_source_location_id: car });
  assert.equal(reused.error?.code, "23505");
});

test("the previous image's signatures still record without a key", async () => {
  const actor = dataClient(user);
  const moved = await actor.rpc("record_inventory_transaction", { p_item_id: gloves, p_transaction_type: "transfer", p_quantity: 1, p_source_location_id: supply, p_destination_location_id: car, p_reason: null, p_reference: null });
  assert.equal(moved.error, null);
  const checkout = await actor.rpc("checkout_inventory", { p_item_id: pooled, p_location_id: supply, p_recipient_type: "unit", p_recipient_user_id: null, p_recipient_unit: "K9", p_recipient_vehicle_id: null, p_quantity: 1, p_due_at: null, p_reason: null, p_reference: null });
  assert.equal(checkout.error, null);
  const returned = await actor.rpc("return_inventory_checkout", { p_checkout_id: row(checkout.data).id, p_quantity: 1, p_reason: null, p_reference: null });
  assert.equal(returned.error, null);
  assert.equal(await scalar("select count(*)::int from public.inventory_checkouts where idempotency_key is null"), 1);
  assert.equal(await scalar("select count(*)::int from pg_proc where proname in ('checkout_inventory','return_inventory_checkout','record_inventory_transaction')"), 6);
});

test("the recipient directory names members and vehicles of the caller's agency only", async () => {
  const listed = await dataClient(user).rpc("inventory_recipient_directory", {});
  assert.equal(listed.error, null);
  const rows = (listed.data as Record<string, unknown>[]).map((row) => [row.recipient_type, row.recipient_id, row.label, row.detail, row.is_active]);
  assert.deepEqual(rows.sort((a, b) => String(a[1]).localeCompare(String(b[1]))), [
    ["officer", user, "Dana Cole", "Sgt · 101 · Patrol", true],
    ["officer", colleague, "Lee Park", "202", true],
    ["officer", former, "Sam Ruiz", null, false],
    ["vehicle", vehicle, "12", "Ford · Explorer · ABC123", true],
    ["vehicle", retired, "7", null, false],
  ]);
  assert.equal(JSON.stringify(listed.data).includes("example.test"), false);
  const foreign = await dataClient(outsider).rpc("inventory_recipient_directory", {});
  assert.equal(foreign.error, null);
  assert.equal(JSON.stringify(foreign.data).includes(user), false);
  const crossTenant = await dataClient(outsider, department).rpc("inventory_recipient_directory", {});
  assert.deepEqual(crossTenant.data, []);
});

test("firearm inspections refuse a second row with the same key in a department", async () => {
  await client.query("insert into public.firearm_inspections(department_id,idempotency_key) values($1,$2)", [department, key(5)]);
  await assert.rejects(() => client.query("insert into public.firearm_inspections(department_id,idempotency_key) values($1,$2)", [department, key(5)]), /firearm_inspections_idempotency_key_idx/);
  await client.query("insert into public.firearm_inspections(department_id,idempotency_key) values($1,$2),($1,null),($1,null)", [other, key(5)]);
});

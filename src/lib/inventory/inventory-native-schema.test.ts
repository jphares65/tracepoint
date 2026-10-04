import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";

const require = createRequire(import.meta.url);
const { default: EmbeddedPostgres } = require("embedded-postgres") as { default: new (input: Record<string, unknown>) => { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; getPgClient(): { connect(): Promise<void>; end(): Promise<void>; query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> } } };
let directory = ""; let database: InstanceType<typeof EmbeddedPostgres>; let client: ReturnType<InstanceType<typeof EmbeddedPostgres>["getPgClient"]>;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-inventory-native-"));
  database = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-only", port: await localPostgresPort(), persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await database.initialise(); await database.start(); client = database.getPgClient(); await client.connect();
  await client.query(`create extension if not exists pgcrypto; create role anon nologin; create role authenticated nologin; create role service_role nologin; create role tracepoint_runtime nologin; create schema tracepoint_auth;
    create function tracepoint_auth.subject_id() returns uuid language sql stable as $$select nullif(current_setting('tracepoint.subject_id',true),'')::uuid$$;
    create function tracepoint_auth.department_id() returns uuid language sql stable as $$select nullif(current_setting('tracepoint.department_id',true),'')::uuid$$;
    create table public.departments(id uuid primary key); create table public.profiles(id uuid primary key); create table public.permissions(code text primary key,display_name text,description text); create table public.department_memberships(department_id uuid,user_id uuid,is_active boolean,primary key(department_id,user_id)); create table public.fleet_vehicles(id uuid primary key,department_id uuid,status text);
    create function public.is_department_member(p_department_id uuid) returns boolean language sql stable as $$select exists(select 1 from public.department_memberships where department_id=p_department_id and user_id=tracepoint_auth.subject_id() and is_active)$$;
    create function public.has_department_permission(p_department_id uuid,p_permission_code text) returns boolean language sql stable as $$select public.is_department_member(p_department_id)$$;`);
  const phase1 = await readFile("database/aws/035_inventory_phase1.sql", "utf8");
  const phase2 = await readFile("database/aws/036_inventory_checkout_phase2a.sql", "utf8");
  await client.query(phase1); await client.query(phase1); await client.query(phase2); await client.query(phase2);
});
after(async () => { await client?.end().catch(() => undefined); await database?.stop().catch(() => undefined); await rm(directory, { recursive: true, force: true }).catch(() => undefined); });

test("native Inventory migration is repeatable and records atomic nonnegative stock", async () => {
  const department="10000000-0000-4000-8000-000000000001", other="10000000-0000-4000-8000-000000000002", user="20000000-0000-4000-8000-000000000001", item="30000000-0000-4000-8000-000000000001", source="40000000-0000-4000-8000-000000000001", destination="40000000-0000-4000-8000-000000000002", foreign="40000000-0000-4000-8000-000000000003";
  await client.query("insert into public.departments values($1),($2)",[department,other]);
  await client.query("insert into public.profiles values($1)",[user]);
  await client.query("insert into public.department_memberships values($1,$2,true)",[department,user]);
  await client.query("insert into public.inventory_items(id,department_id,name,tracking_mode,created_by,updated_by) values($1,$2,'Medical gloves','consumable',$3,$3)",[item,department,user]);
  await client.query("insert into public.inventory_locations(id,department_id,name,created_by,updated_by) values($1,$2,'Supply room',$3,$3),($4,$2,'Car 12',$3,$3),($5,$6,'Foreign',$3,$3)",[source,department,user,destination,foreign,other]);
  await client.query("select set_config('tracepoint.subject_id',$1,false),set_config('tracepoint.department_id',$2,false)",[user,department]);
  await client.query("select public.record_inventory_transaction($1,'receive',10,null,$2,'initial delivery','PO-1')",[item,source]);
  await client.query("select public.record_inventory_transaction($1,'transfer',3,$2,$3,'restock','CAR-12')",[item,source,destination]);
  await assert.rejects(() => client.query("select public.record_inventory_transaction($1,'adjust',-8,$2,null,'bad count',null)",[item,source]),/cannot fall below zero/);
  await assert.rejects(() => client.query("select public.record_inventory_transaction($1,'receive',1,null,$2,'bad tenant',null)",[item,foreign]),/destination location unavailable/);
  const balances=await client.query("select inventory_location_id,on_hand_quantity::text from public.inventory_balances where inventory_item_id=$1 order by inventory_location_id",[item]);
  assert.deepEqual(balances.rows.map(row=>row.on_hand_quantity),["7.000","3.000"]);
  assert.equal((await client.query("select count(*)::int as count from public.inventory_transactions where inventory_item_id=$1",[item])).rows[0].count,2);
});

test("pooled checkout supports partial and full return without rewriting history", async () => {
  const department="10000000-0000-4000-8000-000000000001", item="30000000-0000-4000-8000-000000000001", source="40000000-0000-4000-8000-000000000001", user="20000000-0000-4000-8000-000000000001";
  await client.query("update public.inventory_items set tracking_mode='pooled' where id=$1",[item]);
  const checkout=(await client.query("select (public.checkout_inventory($1,$2,'officer',$3,null,null,5,now()+interval '1 hour','shift','C-1')).id as id",[item,source,user])).rows[0].id as string;
  await assert.rejects(()=>client.query("select public.checkout_inventory($1,$2,'officer',$3,null,null,8,null,null,null)",[item,source,user]),/exceeds available quantity/);
  await client.query("select public.return_inventory_checkout($1,2,'partial',null)",[checkout]);
  await assert.rejects(()=>client.query("select public.return_inventory_checkout($1,4,'too much',null)",[checkout]),/exceeds outstanding quantity/);
  await client.query("select public.return_inventory_checkout($1,3,'complete',null)",[checkout]);
  const state=await client.query("select closed_at is not null as closed,(select coalesce(sum(quantity),0)::text from public.inventory_checkout_returns where inventory_checkout_id=$1) as returned from public.inventory_checkouts where id=$1",[checkout]);
  assert.deepEqual(state.rows,[{closed:true,returned:"5.000"}]);
  assert.equal((await client.query("select count(*)::int as count from public.inventory_transactions where inventory_item_id=$1 and transaction_type in ('checkout','checkin')",[item])).rows[0].count,3);
});

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";

import { PostgresDataClient } from "./postgres-data-client.ts";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { isAwsNativeSchemaFile } from "../../test-support/aws-native-schema-files.mjs";
import { supabasePrerequisites } from "../../../scripts/postgres-bootstrap-prerequisites.mjs";

// The routes' exact query chains through the AWS-native data client, on the full
// schema with row-level security (tracepoint_runtime -> authenticated):
// D-3 GET /api/inventory/checkouts embeds inventory_checkout_returns;
// D-4 GET /api/agency-documents/context?kind=person&search= filters on profiles in an OR.
const A = "dddddddd-0000-4000-8000-00000000000a", B = "dddddddd-0000-4000-8000-00000000000b";
const admin = "a0000000-0000-4000-8000-0000000000a1", officer = "a0000000-0000-4000-8000-0000000000c1";
const colleague = "a0000000-0000-4000-8000-0000000000c2", foreignAdmin = "b0000000-0000-4000-8000-0000000000a1";
const foreignOfficer = "b0000000-0000-4000-8000-0000000000c1";
const item = "30000000-0000-4000-8000-000000000001", location = "40000000-0000-4000-8000-000000000001";
let server: EmbeddedPostgres, owner: pg.Pool, runtime: pg.Pool, directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-data-client-relations-"));
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
  const people: Array<[string, string]> = [[admin, "Avery Admin"], [officer, "Olive Martinez"], [colleague, "Carl Jones"], [foreignAdmin, "Foreign Admin"], [foreignOfficer, "Olivia Martinez"]];
  for (const [id, name] of people) {
    await owner.query("insert into auth.users(id,email) values($1,$2)", [id, `${id.slice(-2)}@example.test`]);
    await owner.query("insert into public.profiles(id,full_name,email) values($1,$2,$3) on conflict(id) do update set full_name=excluded.full_name", [id, name, `${id.slice(-2)}@example.test`]);
  }
  await owner.query("insert into public.departments(id,name,short_name,slug,created_by) values($1,'Dept A','DA','dept-a',$3),($2,'Dept B','DB','dept-b',$4)", [A, B, admin, foreignAdmin]);
  await owner.query(`insert into public.department_memberships(department_id,user_id,badge_number,is_active,activation_status)
    values($1,$3,'A-1',true,'activated'),($1,$4,'1042',true,'activated'),($1,$5,'2077',true,'activated'),($2,$6,'B-1',true,'activated'),($2,$7,'1042',true,'activated')`,
    [A, B, admin, officer, colleague, foreignAdmin, foreignOfficer]);
  await owner.query(`insert into public.department_membership_roles(department_id,user_id,role_code)
    values($1,$3,'administrator'),($1,$4,'officer'),($1,$5,'officer'),($2,$6,'administrator'),($2,$7,'officer')`, [A, B, admin, officer, colleague, foreignAdmin, foreignOfficer]);
  for (const department of [A, B]) {
    for (const feature of ["inventory", "agency_documents"]) {
      await owner.query("insert into public.department_features(department_id,feature_code,is_enabled) values($1,$2,true) on conflict (department_id,feature_code) do update set is_enabled=true", [department, feature]);
    }
  }
  await owner.query("insert into public.inventory_items(id,department_id,name,tracking_mode,created_by,updated_by) values($1,$2,'Radios','pooled',$3,$3)", [item, A, admin]);
  await owner.query("insert into public.inventory_locations(id,department_id,name,created_by,updated_by) values($1,$2,'Supply room',$3,$3)", [location, A, admin]);
});

after(async () => { await runtime?.end(); await owner?.end(); await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

const client = (subject: string, department: string) => new PostgresDataClient(runtime as never, subject, department);

// GET /api/inventory/checkouts, open and history.
const checkouts = (db: PostgresDataClient, department: string, history: boolean) => {
  let query = db.from("inventory_checkouts").select("*,inventory_checkout_returns(quantity,returned_at,returned_by,reason,reference)").eq("department_id", department).order("checked_out_at", { ascending: false });
  if (!history) query = query.is("closed_at", null);
  return query;
};
// GET /api/agency-documents/context?kind=person&search=...
const people = (db: PostgresDataClient, department: string, search: string) => {
  let query = db.from("department_memberships").select("user_id,badge_number,rank_title,profiles!inner(full_name,email)").eq("department_id", department).eq("is_active", true).limit(50);
  if (search) query = query.or(`badge_number.ilike.%${search}%,profiles.full_name.ilike.%${search}%`);
  return query;
};

test("D-3: the checkout list embeds each checkout's returns", async () => {
  const db = client(admin, A);
  const issued = await db.rpc("record_inventory_transaction", { p_item_id: item, p_transaction_type: "receive", p_quantity: 10, p_source_location_id: null, p_destination_location_id: location, p_reason: "delivery", p_reference: null });
  assert.equal(issued.error, null, JSON.stringify(issued.error));
  const open = await db.rpc("checkout_inventory", { p_item_id: item, p_location_id: location, p_recipient_type: "officer", p_recipient_user_id: officer, p_recipient_unit: null, p_recipient_vehicle_id: null, p_quantity: 3, p_due_at: null, p_reason: "shift", p_reference: null });
  assert.equal(open.error, null, JSON.stringify(open.error));
  const id = (Array.isArray(open.data) ? open.data[0] : open.data as { id: string }).id;
  assert.equal((await db.rpc("return_inventory_checkout", { p_checkout_id: id, p_quantity: 1, p_reason: "partial", p_reference: null })).error, null);

  const listed = await checkouts(db, A, false);
  assert.equal(listed.error, null, JSON.stringify(listed.error));
  const rows = listed.data as Array<{ id: string; inventory_checkout_returns: Array<{ quantity: string | number; reason: string }> }>;
  assert.deepEqual(rows.map((row) => row.id), [id]);
  assert.deepEqual(rows[0].inventory_checkout_returns.map((entry) => [Number(entry.quantity), entry.reason]), [[1, "partial"]]);

  const second = await db.rpc("checkout_inventory", { p_item_id: item, p_location_id: location, p_recipient_type: "unit", p_recipient_user_id: null, p_recipient_unit: "K9", p_recipient_vehicle_id: null, p_quantity: 1, p_due_at: null, p_reason: null, p_reference: null });
  assert.equal(second.error, null);
  const history = await checkouts(db, A, true);
  assert.equal(history.error, null);
  const byId = new Map((history.data as Array<{ id: string; inventory_checkout_returns: unknown[] }>).map((row) => [row.id, row.inventory_checkout_returns]));
  assert.deepEqual(byId.get((Array.isArray(second.data) ? second.data[0] : second.data as { id: string }).id), [], "a checkout without returns embeds an empty list");
});

test("D-3: another agency's administrator lists none of these checkouts", async () => {
  const listed = await checkouts(client(foreignAdmin, B), B, true);
  assert.equal(listed.error, null);
  assert.deepEqual(listed.data, []);
});

test("D-4: the person search matches a name or a badge in the caller's agency", async () => {
  const db = client(admin, A);
  const all = await people(db, A, "");
  assert.equal(all.error, null);
  assert.equal((all.data as unknown[]).length, 3);

  const byName = await people(db, A, "martinez");
  assert.equal(byName.error, null, JSON.stringify(byName.error));
  assert.deepEqual((byName.data as Array<{ user_id: string; profiles: { full_name: string } }>).map((row) => [row.user_id, row.profiles.full_name]), [[officer, "Olive Martinez"]]);

  const byBadge = await people(db, A, "1042");
  assert.equal(byBadge.error, null);
  assert.deepEqual((byBadge.data as Array<{ user_id: string }>).map((row) => row.user_id), [officer], "the other agency's 1042 is not listed");

  const none = await people(db, A, "nobody");
  assert.equal(none.error, null);
  assert.deepEqual(none.data, []);
});

test("D-4: a relation OR filter on a relation the query did not select is refused", async () => {
  const query = client(admin, A).from("department_memberships").select("user_id").eq("department_id", A).or("badge_number.ilike.%1%,profiles.full_name.ilike.%a%");
  const result = await query;
  assert.notEqual(result.error, null);
});

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
import { isoToZonedLocal, zonedLocalToIso } from "./event-time.ts";

// B7: agency-training closeout and reopen on the full AWS-native schema
// (Supabase lineage plus database/aws), called as the runtime does
// (tracepoint_runtime -> authenticated, subject and agency set).
const A = "0e510000-0000-4000-8000-00000000000a";
const manager = "0e510000-0000-4000-8000-0000000000a3", officer = "0e510000-0000-4000-8000-0000000000a1";
const cpr = "0e510000-0000-4000-8000-0000000007a1";
let server: EmbeddedPostgres, owner: pg.Pool, runtime: pg.Pool, directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-training-closeout-"));
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
  runtime = new pg.Pool({ host: "127.0.0.1", port, user: "tracepoint_runtime", password: "synthetic-runtime-only", database: "postgres" });
  for (const id of [manager, officer]) await owner.query("insert into auth.users(id,email) values($1,$2)", [id, `${id.slice(-2)}@example.test`]);
  await owner.query("insert into public.departments(id,name,slug) values($1,'B7 native','b7-native')", [A]);
  await owner.query("delete from public.department_role_permissions where department_id=$1", [A]);
  await owner.query("insert into public.department_memberships(department_id,user_id,is_active) values($1,$2,true),($1,$3,true)", [A, manager, officer]);
  await owner.query("insert into public.department_membership_roles(department_id,user_id,role_code) values($1,$2,'instructor'),($1,$3,'officer')", [A, manager, officer]);
  await owner.query("insert into public.department_role_permissions(department_id,role_code,permission_code) values($1,'instructor','manage_training')", [A]);
  await owner.query("insert into public.certification_types(id,department_id,name,expiration_required,default_valid_days) values($1,$2,'CPR',true,730)", [cpr, A]);
});

after(async () => { await runtime?.end(); await owner?.end(); await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

async function as<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await runtime.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('tracepoint.subject_id',$1,true),set_config('tracepoint.department_id',$2,true)", [manager, A]);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

test("closeout, reopen and the TRN-04 rule (validate-local-training-closeout.sql)", async () => {
  await owner.query(await readFile("scripts/validate-local-training-closeout.sql", "utf8"));
});

test("closeout issue date is the event's start date in the department time zone, matching the editor", async () => {
  const cases: Array<[string, string]> = [
    ["America/Los_Angeles", "2026-10-24T18:00"], ["America/New_York", "2026-11-01T23:30"],
    ["Asia/Kolkata", "2026-10-25T00:30"], ["Pacific/Honolulu", "2026-12-31T20:00"], ["Europe/London", "2026-03-29T00:30"],
  ];
  for (const [index, [zone, local]] of cases.entries()) {
    const startsAt = zonedLocalToIso(local, zone)!;
    const event = `0e510000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`;
    const attendee = `0e510000-0000-4000-8000-0000000003${String(index).padStart(2, "0")}`;
    await owner.query("update public.departments set timezone=$2 where id=$1", [A, zone]);
    await owner.query("insert into public.agency_training_events(id,department_id,title,starts_at,status,certification_type_id) values($1,$2,'CPR',$3,'in_progress',$4)", [event, A, startsAt, cpr]);
    await owner.query("insert into public.agency_training_attendees(id,department_id,event_id,user_id,attendance_status,outcome_status) values($1,$2,$3,$4,'present','passed')", [attendee, A, event, officer]);
    await as((client) => client.query("select public.close_agency_training_event($1,$2,$3)", [A, event, manager]));
    const issued = await owner.query("select issue_date::text from public.training_certifications where source_training_attendee_id=$1", [attendee]);
    assert.equal(issued.rows[0]?.issue_date, isoToZonedLocal(startsAt, zone).slice(0, 10), zone);
    assert.equal(issued.rows[0]?.issue_date, local.slice(0, 10), zone);
  }
});

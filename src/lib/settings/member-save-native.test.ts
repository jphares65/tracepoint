import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";

import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { supabasePrerequisites } from "../../../scripts/postgres-bootstrap-prerequisites.mjs";
import { withPostgresAuthorization } from "../database/postgres-authorization-core.ts";
import { saveDepartmentMember, type DepartmentMemberSave } from "./member-save.ts";

// ADM-20: Settings > Edit Access on the full AWS-native schema (Supabase lineage
// plus database/aws), through withPostgresAuthorization as the route runs it.
const A = "eeeeeeee-0000-4000-8000-00000000000a";
const admin = "b0000000-0000-4000-8000-0000000000a1", supervisor = "b0000000-0000-4000-8000-0000000000b1";
const officer = "b0000000-0000-4000-8000-0000000000c1", group = "b0000000-0000-4000-8000-0000000000f1";
const databaseName = "postgres";
let server: EmbeddedPostgres, owner: pg.Pool, runtime: pg.Pool, directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-member-save-"));
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
  for (const [id, name] of [[admin, "admin"], [supervisor, "supervisor"], [officer, "officer"]]) {
    await owner.query("insert into auth.users(id,email) values($1,$2)", [id, `${name}@example.test`]);
    await owner.query("insert into public.profiles(id,full_name,email) values($1,$2,$3) on conflict(id) do update set full_name=excluded.full_name,email=excluded.email", [id, name, `${name}@example.test`]);
  }
  await owner.query("insert into public.departments(id,name,short_name,slug,created_by) values($1,'Dept A','DA','dept-a',$2)", [A, admin]);
  await owner.query(`insert into public.department_memberships(department_id,user_id,badge_number,rank_title,unit_name,employee_number,is_active,activation_status)
    values($1,$2,'A-1',null,null,null,true,'activated'),($1,$3,'S-1',null,null,null,true,'activated'),($1,$4,'O-1','Officer','Patrol','E-1',true,'activated')`, [A, admin, supervisor, officer]);
  await owner.query("insert into public.department_membership_roles(department_id,user_id,role_code) values($1,$2,'administrator'),($1,$3,'supervisor'),($1,$4,'officer')", [A, admin, supervisor, officer]);
  await owner.query("insert into public.department_role_permissions(department_id,role_code,permission_code) values($1,'supervisor','manage_users') on conflict do nothing", [A]);
  await owner.query("insert into public.department_groups(id,department_id,name,is_active) values($1,$2,'Day Shift',true)", [group, A]);
});

after(async () => { await runtime?.end(); await owner?.end(); await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

const save = (subject: string, input: Partial<DepartmentMemberSave>) => withPostgresAuthorization(runtime, { subjectId: subject, departmentId: A },
  (client) => saveDepartmentMember(client, { p_department_id: A, p_user_id: officer, p_badge_number: "O-1", p_rank_title: "Officer", p_unit_name: "Patrol",
    p_employee_number: "E-1", p_is_active: true, p_role_codes: ["officer"], p_group_ids: [], ...input }));
const state = async () => ({
  ...(await owner.query("select badge_number,is_active from public.department_memberships where department_id=$1 and user_id=$2", [A, officer])).rows[0],
  roles: (await owner.query("select array_agg(role_code order by role_code) r from public.department_membership_roles where department_id=$1 and user_id=$2", [A, officer])).rows[0].r,
  groups: Number((await owner.query("select count(*) n from public.department_group_members where department_id=$1 and user_id=$2", [A, officer])).rows[0].n),
});

test("ADM-20: a member save applies details, roles and groups together", async () => {
  await save(admin, { p_badge_number: "O-2", p_role_codes: ["officer", "supervisor"], p_group_ids: [group] });
  assert.deepEqual(await state(), { badge_number: "O-2", is_active: true, roles: ["officer", "supervisor"], groups: 1 });
});

test("ADM-20: a refused role change rolls back the deactivation and detail change saved before it", async () => {
  const before = await state();
  await assert.rejects(save(supervisor, { p_badge_number: "O-9", p_is_active: false, p_role_codes: ["administrator"], p_group_ids: [] }),
    /Only a department or platform Administrator may modify the Administrator role/);
  assert.deepEqual(await state(), before);
});

test("ADM-20: a refused group change rolls back the details and roles saved before it", async () => {
  const before = await state();
  await assert.rejects(save(admin, { p_badge_number: "O-8", p_role_codes: ["officer"], p_group_ids: ["b0000000-0000-4000-8000-0000000000ff"] }));
  assert.deepEqual(await state(), before);
});

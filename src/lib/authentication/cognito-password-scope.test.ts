import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";

const require = createRequire(import.meta.url);
const { default: EmbeddedPostgres } = require("embedded-postgres") as {
  default: new (input: Record<string, unknown>) => {
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    getPgClient(): {
      connect(): Promise<void>;
      end(): Promise<void>;
      query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
    };
  };
};

type LocalPg = ReturnType<InstanceType<typeof EmbeddedPostgres>["getPgClient"]>;
let directory = "";
let database: InstanceType<typeof EmbeddedPostgres>;
let first: LocalPg;
let second: LocalPg;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-password-scope-"));
  database = new EmbeddedPostgres({
    databaseDir: directory,
    user: "postgres",
    password: "local-only",
    port: await localPostgresPort(),
    persistent: true,
    postgresFlags: ["-h", "127.0.0.1"],
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });
  await database.initialise();
  await database.start();
  first = database.getPgClient();
  second = database.getPgClient();
  await Promise.all([first.connect(), second.connect()]);
  await first.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create role tracepoint_runtime nologin;
    create schema tracepoint_auth;
    create table public.authentication_lifecycle_operations (
      id uuid primary key,
      operation_kind text not null,
      tracepoint_user_id uuid not null,
      department_id uuid not null,
      state text not null
    );
    create table public.department_memberships (
      department_id uuid not null,
      user_id uuid not null,
      is_active boolean not null default true,
      primary key (department_id, user_id)
    );
    create table public.platform_admins (
      user_id uuid primary key,
      is_active boolean not null default true
    );
  `);
  await first.query(await readFile(new URL("../../../database/aws/039_cognito_password_global_scope.sql", import.meta.url), "utf8"));
});

after(async () => {
  await first?.query("rollback").catch(() => undefined);
  await second?.query("rollback").catch(() => undefined);
  await Promise.all([first?.end().catch(() => undefined), second?.end().catch(() => undefined)]);
  await database?.stop().catch(() => undefined);
  if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
});

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hasSqlState = (error: unknown, expectedCode: string) =>
  typeof error === "object" && error !== null && "code" in error && error.code === expectedCode;
const operation = (id: string, user: string, department: string) =>
  first.query(
    "insert into public.authentication_lifecycle_operations(id,operation_kind,tracepoint_user_id,department_id,state) values($1,'reset_password',$2,$3,'prepared')",
    [id, user, department],
  );

test("scope-write-first serializes and denies password preparation", async () => {
  const user = "20000000-0000-4000-8000-000000000001";
  const departmentA = "10000000-0000-4000-8000-000000000001";
  const departmentB = "10000000-0000-4000-8000-000000000002";
  await first.query("begin");
  await first.query("insert into public.department_memberships(department_id,user_id) values($1,$2)", [departmentB, user]);
  await second.query("begin");

  let settled = false;
  const insertion = second.query(
    "insert into public.authentication_lifecycle_operations(id,operation_kind,tracepoint_user_id,department_id,state) values($1,'reset_password',$2,$3,'prepared')",
    ["30000000-0000-4000-8000-000000000001", user, departmentA],
  ).then(() => ({ error: null }), (error: unknown) => ({ error }));
  void insertion.then(() => { settled = true; });
  await pause(100);
  assert.equal(settled, false, "password preparation waits on the same identity lock");
  await first.query("commit");
  assert.equal(hasSqlState((await insertion).error, "42501"), true);
  await second.query("rollback");
});

test("operation-first serializes and denies a new department membership", async () => {
  const user = "20000000-0000-4000-8000-000000000002";
  const departmentA = "10000000-0000-4000-8000-000000000001";
  const departmentB = "10000000-0000-4000-8000-000000000002";
  await first.query("begin");
  await operation("30000000-0000-4000-8000-000000000002", user, departmentA);
  await second.query("begin");

  let settled = false;
  const insertion = second.query(
    "insert into public.department_memberships(department_id,user_id) values($1,$2)",
    [departmentB, user],
  ).then(() => ({ error: null }), (error: unknown) => ({ error }));
  void insertion.then(() => { settled = true; });
  await pause(100);
  assert.equal(settled, false, "scope addition waits on the same identity lock");
  await first.query("commit");
  assert.equal(hasSqlState((await insertion).error, "42501"), true);
  await second.query("rollback");
});

test("unresolved password operations hold scope through compensation_required and release after commit", async () => {
  const user = "20000000-0000-4000-8000-000000000003";
  const departmentA = "10000000-0000-4000-8000-000000000001";
  const departmentB = "10000000-0000-4000-8000-000000000002";
  const operationId = "30000000-0000-4000-8000-000000000003";
  await operation(operationId, user, departmentA);

  const assertHeld = async () => {
    await assert.rejects(
      first.query("insert into public.department_memberships(department_id,user_id) values($1,$2)", [departmentB, user]),
      (error: unknown) => hasSqlState(error, "42501"),
    );
    await assert.rejects(
      first.query("insert into public.platform_admins(user_id,is_active) values($1,true)", [user]),
      (error: unknown) => hasSqlState(error, "42501"),
    );
  };

  await assertHeld();
  await first.query("update public.authentication_lifecycle_operations set state='compensation_required' where id=$1", [operationId]);
  await assertHeld();
  await first.query("update public.authentication_lifecycle_operations set state='committed' where id=$1", [operationId]);
  await first.query("insert into public.department_memberships(department_id,user_id) values($1,$2)", [departmentB, user]);
  await first.query("insert into public.platform_admins(user_id,is_active) values($1,true)", [user]);
});

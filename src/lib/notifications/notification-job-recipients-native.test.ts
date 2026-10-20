import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { postgresGenerationLock, postgresGenerationTargets } from "./generation-run-postgres.ts";

const require = createRequire(import.meta.url);
type Client = { connect(): Promise<void>; end(): Promise<void>; query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
const { default: EmbeddedPostgres } = require("embedded-postgres") as { default: new (input: Record<string, unknown>) => { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; getPgClient(): Client } };

let directory = "";
let database: InstanceType<typeof EmbeddedPostgres>;
let client: Client;

const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const closed = "10000000-0000-4000-8000-00000000000c";
const a1 = "20000000-0000-4000-8000-000000000001";
const a2 = "20000000-0000-4000-8000-000000000002";
const separated = "20000000-0000-4000-8000-000000000003";
const b1 = "20000000-0000-4000-8000-000000000004";
const c1 = "20000000-0000-4000-8000-000000000005";

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-notification-jobs-"));
  database = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-only", port: await localPostgresPort(), persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await database.initialise();
  await database.start();
  client = database.getPgClient();
  await client.connect();
  await client.query(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin; create role tracepoint_runtime nologin;
    grant authenticated to tracepoint_runtime;
    create schema tracepoint_auth;
    grant usage on schema public, tracepoint_auth to tracepoint_runtime, authenticated;
    create table public.departments(id uuid primary key, is_active boolean not null default true);
    create table public.department_memberships(department_id uuid, user_id uuid, is_active boolean, primary key(department_id,user_id));
  `);
  await client.query("insert into public.departments values ($1,true),($2,true),($3,false)", [A, B, closed]);
  await client.query("insert into public.department_memberships values ($1,$4,true),($1,$5,true),($1,$6,false),($2,$7,true),($3,$8,true)", [A, B, closed, a1, a2, separated, b1, c1]);
});

after(async () => { await client?.end().catch(() => undefined); await database?.stop().catch(() => undefined); await rm(directory, { recursive: true, force: true }).catch(() => undefined); });

// The application's web login: session_user tracepoint_runtime, as in production.
async function asRuntime<T>(statements: () => Promise<T>, role?: string) {
  await client.query("set session authorization tracepoint_runtime");
  if (role) await client.query(`set role ${role}`);
  try { return await statements(); }
  finally { await client.query("reset session authorization"); }
}
const pool = { query: (sql: string, values?: unknown[]) => client.query(sql, values) };
const list = (departmentId: string | null, after: { departmentId: string; userId: string } | null, limit: number) =>
  asRuntime(() => postgresGenerationTargets(pool as never)({ departmentId, after, limit }));

test("migration 047 is repeatable", async () => {
  const sql = await readFile("database/aws/047_notification_job_recipients.sql", "utf8");
  assert.match(sql.trim(), /^begin;[\s\S]*commit;$/);
  await client.query(sql);
  await client.query(sql);
});

test("generation targets are the active members of active agencies, in pages", async () => {
  assert.deepEqual(await list(null, null, 50), [
    { departmentId: A, userId: a1 }, { departmentId: A, userId: a2 }, { departmentId: B, userId: b1 },
  ]);
  assert.deepEqual(await list(A, null, 50), [{ departmentId: A, userId: a1 }, { departmentId: A, userId: a2 }]);
  assert.deepEqual(await list(null, null, 2), [{ departmentId: A, userId: a1 }, { departmentId: A, userId: a2 }]);
  assert.deepEqual(await list(null, { departmentId: A, userId: a2 }, 2), [{ departmentId: B, userId: b1 }]);
  assert.deepEqual(await list(B, { departmentId: B, userId: b1 }, 2), []);
  for (const limit of [0, 501]) await assert.rejects(list(null, null, limit), { code: "22023" });
  await assert.rejects(asRuntime(() => client.query("select * from tracepoint_auth.list_notification_generation_targets(null,$1,null,10)", [A])), { code: "22023" });
});

test("recipient check follows membership and agency state", async () => {
  const active = (departmentId: string, userId: string) => asRuntime(async () => (await client.query("select tracepoint_auth.notification_recipient_active($1,$2) as active", [departmentId, userId])).rows[0].active);
  assert.equal(await active(A, a1), true);
  assert.equal(await active(A, separated), false, "deactivated member");
  assert.equal(await active(B, a1), false, "another agency");
  assert.equal(await active(closed, c1), false, "inactive agency");
});

test("only the trusted web login may call either function", async () => {
  const calls = ["select * from tracepoint_auth.list_notification_generation_targets(null,null,null,10)", `select tracepoint_auth.notification_recipient_active('${A}','${a1}')`];
  for (const sql of calls) {
    await assert.rejects(client.query(sql), { code: "42501" }, "another login (superuser session)");
    await assert.rejects(asRuntime(() => client.query(sql), "authenticated"), { code: "42501" }, "a subject-bound session");
  }
  const grants = await client.query(`select has_function_privilege('authenticated','tracepoint_auth.list_notification_generation_targets(uuid,uuid,uuid,integer)','execute') as list_authenticated,
    has_function_privilege('anon','tracepoint_auth.notification_recipient_active(uuid,uuid)','execute') as check_anon,
    has_function_privilege('tracepoint_runtime','tracepoint_auth.notification_recipient_active(uuid,uuid)','execute') as check_runtime`);
  assert.deepEqual(grants.rows[0], { list_authenticated: false, check_anon: false, check_runtime: true });
});

test("concurrent generation runs do not overlap", async () => {
  const connections = { connect: async () => { const connection = database.getPgClient(); await connection.connect(); return Object.assign(connection, { release: () => { void connection.end(); } }); } };
  const lock = postgresGenerationLock(connections as never);
  let finish = () => {};
  const first = lock(() => new Promise<string>((resolve) => { finish = () => resolve("first"); }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(await lock(async () => "second"), { acquired: false });
  finish();
  assert.deepEqual(await first, { acquired: true, value: "first" });
  assert.deepEqual(await lock(async () => "third"), { acquired: true, value: "third" });
});

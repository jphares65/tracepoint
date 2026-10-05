import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";

const require = createRequire(import.meta.url);
const { default: EmbeddedPostgres } = require("embedded-postgres") as { default: new (input: Record<string, unknown>) => { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; getPgClient(): { connect(): Promise<void>; end(): Promise<void>; query(sql: string): Promise<{ rows: Record<string, unknown>[] }> } } };

let directory = "";
let database: InstanceType<typeof EmbeddedPostgres>;
let client: ReturnType<InstanceType<typeof EmbeddedPostgres>["getPgClient"]>;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-fleet-documents-native-"));
  database = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-only", port: await localPostgresPort(), persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await database.initialise();
  await database.start();
  client = database.getPgClient();
  await client.connect();
  await client.query("create table public.attachments(id uuid primary key, department_id uuid not null, entity_id uuid, entity_type text not null, archived_at timestamptz)");
});

after(async () => { await client?.end().catch(() => undefined); await database?.stop().catch(() => undefined); await rm(directory, { recursive: true, force: true }).catch(() => undefined); });

test("AWS-native ledger retains migration 033 for Fleet document metadata", async () => {
  const files = (await readdir("database/aws")).filter((file) => file.endsWith(".sql")).sort();
  assert.ok(files.includes("033_fleet_vehicle_document_metadata.sql"));
  assert.equal(new Set(files.map((file) => file.slice(0, 3))).size, files.length);
});

test("Fleet document metadata migration is repeatable and creates only the active-document index", async () => {
  const sql = await readFile("database/aws/033_fleet_vehicle_document_metadata.sql", "utf8");
  await client.query(sql);
  await client.query(sql);
  const column = await client.query("select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'attachments' and column_name = 'expiration_date'");
  assert.deepEqual(column.rows, [{ data_type: "date", is_nullable: "YES" }]);
  const index = await client.query("select indexdef from pg_indexes where schemaname = 'public' and tablename = 'attachments' and indexname = 'attachments_fleet_vehicle_document_active_idx'");
  assert.match(String(index.rows[0]?.indexdef), /WHERE \(\(entity_type = 'fleet_vehicle_document'::text\) AND \(archived_at IS NULL\)\)/);
});

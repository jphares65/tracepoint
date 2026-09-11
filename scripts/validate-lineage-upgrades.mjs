import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { localPostgresPort } from "../src/test-support/local-postgres-port.mjs";
import { supabasePrerequisites } from "./postgres-bootstrap-prerequisites.mjs";
import { catalogSql, manifestSql } from "./staging-management-manifest.mjs";

try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    uid: -1,
    gid: -1,
    username: "local",
    homedir: tmpdir(),
    shell: null,
  });
  syncBuiltinESMExports();
}

const { default: EmbeddedPostgres } = await import("embedded-postgres");
const execFileAsync = promisify(execFile);
const migrationsDir = path.resolve("supabase/migrations");
const stagingFixturesDir = path.resolve(
  "scripts/fixtures/migration-lineages/staging",
);
const databaseDir = await mkdtemp(
  path.join(tmpdir(), "tracepoint-lineage-upgrades-"),
);
const port = await localPostgresPort();
const postgres = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "local-upgrade-only",
  port,
  persistent: false,
  postgresFlags: ["-h", "127.0.0.1"],
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: (message) => console.error(message),
});

const migrationVersion = (file) => path.basename(file).split("_", 1)[0];
const readSql = async (file) =>
  (await readFile(file, "utf8")).replace(/^\uFEFF/, "");

let admin;
let started = false;
try {
  const currentFiles = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort()
    .map((file) => path.join(migrationsDir, file));
  const currentVersions = currentFiles.map(migrationVersion);
  assert.equal(currentFiles.length, 75);
  assert.equal(new Set(currentVersions).size, currentVersions.length);

  const common = currentFiles.filter(
    (file) => migrationVersion(file) < "202609050001",
  );
  const productionBaseline = [
    ...common,
    path.join(
      migrationsDir,
      "202609050001_permission_controlled_editing.sql",
    ),
    path.join(
      migrationsDir,
      "202609050002_granular_permission_authority.sql",
    ),
    path.join(
      migrationsDir,
      "202609060001_retire_legacy_training_alert_permissions.sql",
    ),
  ];
  const stagingBaseline = [
    ...common,
    path.join(
      stagingFixturesDir,
      "202609050001_server_role_table_privileges.sql",
    ),
    path.join(
      stagingFixturesDir,
      "202609050002_authenticated_policy_privileges.sql",
    ),
    ...currentFiles.filter((file) => {
      const version = migrationVersion(file);
      return version >= "202609050003" && version <= "202609050011";
    }),
  ];

  await postgres.initialise();
  await postgres.start();
  started = true;
  admin = postgres.getPgClient();
  await admin.connect();
  await admin.query("set statement_timeout = '30s'");
  await admin.query(
    "create role anon nologin; create role authenticated nologin; create role service_role nologin",
  );
  const databasePrerequisites = supabasePrerequisites.replace(
    /^\s*create role .+;\s*$/gm,
    "",
  );

  async function connect(database) {
    const client = new admin.constructor({
      host: "127.0.0.1",
      port,
      user: "postgres",
      password: "local-upgrade-only",
      database,
    });
    await client.connect();
    await client.query("set statement_timeout = '30s'");
    return client;
  }

  async function apply(client, file) {
    await client.query(await readSql(file));
    await client.query(
      "insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)",
      [
        migrationVersion(file),
        path.basename(file).replace(/^\d+_/, "").replace(/\.sql$/, ""),
        [await readSql(file)],
      ],
    );
  }

  async function build(name, baseline) {
    await admin.query(`create database ${name}`);
    const client = await connect(name);
    try {
      await client.query(databasePrerequisites);
      await client.query(
        "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])",
      );
      const applied = new Set();
      for (const file of baseline) {
        const version = migrationVersion(file);
        assert.ok(!applied.has(version), `${name} duplicate baseline ${version}`);
        await apply(client, file);
        applied.add(version);
      }
      for (const file of currentFiles) {
        if (!applied.has(migrationVersion(file))) {
          await apply(client, file);
          applied.add(migrationVersion(file));
        }
      }
      assert.deepEqual([...applied].sort(), currentVersions);
      const catalog = (await client.query(catalogSql)).rows[0];
      const manifestResults = await client.query(
        manifestSql(catalog, currentVersions),
      );
      const manifest = (
        Array.isArray(manifestResults)
          ? manifestResults
          : [manifestResults]
      ).find((result) => result.rows?.[0]?.manifest)?.rows[0].manifest;
      assert.ok(manifest);
      const columns = (
        await client.query(`
          select table_name, column_name, column_default, is_nullable,
            data_type, udt_schema, udt_name
          from information_schema.columns
          where table_schema = 'public'
          order by table_name, column_name
        `)
      ).rows;
      const semanticMetadata = { ...manifest.metadata };
      delete semanticMetadata.columns;
      return {
        tables: catalog.tables,
        sequences: catalog.sequences,
        foreignKeys: catalog.foreign_keys,
        columns,
        metadata: semanticMetadata,
      };
    } finally {
      await client.end();
    }
  }

  const clean = await build("tracepoint_clean", []);
  const production = await build(
    "tracepoint_production_upgrade",
    productionBaseline,
  );
  const staging = await build(
    "tracepoint_staging_upgrade",
    stagingBaseline,
  );
  assert.deepEqual(production, clean);
  assert.deepEqual(staging, clean);
  console.log(
    JSON.stringify({
      migrations: currentVersions.length,
      cleanBootstrap: "passed",
      productionUpgrade: "passed",
      stagingUpgrade: "passed",
      structuralParity: "passed",
    }),
  );
} finally {
  if (admin) await admin.end().catch(() => {});
  if (started && postgres.process?.spawnfile) {
    const pgCtl = path.join(
      path.dirname(postgres.process.spawnfile),
      process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl",
    );
    await execFileAsync(
      pgCtl,
      ["stop", "-D", databaseDir, "-m", "fast", "-w"],
      { timeout: 20_000 },
    ).catch(() => {});
    postgres.process = undefined;
  }
  await rm(databaseDir, { recursive: true, force: true }).catch(() => {});
}

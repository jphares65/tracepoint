import { localPostgresPort } from "../src/test-support/local-postgres-port.mjs";
import { catalogSql, manifestSql } from "./staging-management-manifest.mjs";
import { supabasePrerequisites } from "./postgres-bootstrap-prerequisites.mjs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// Some locked-down Windows runners deny uv_os_get_passwd. Embedded Postgres
// only needs the uid to avoid launching PostgreSQL as root (not applicable on
// Windows), so provide a non-root fallback when that OS lookup is unavailable.
try {
  os.userInfo();
} catch {
  os.userInfo = () => ({ uid: -1, gid: -1, username: "local", homedir: tmpdir(), shell: null });
  syncBuiltinESMExports();
}
const { default: EmbeddedPostgres } = await import("embedded-postgres");
const execFileAsync = promisify(execFile);

const expectedMigrationCount = 75;
const migrationsDir = path.resolve("supabase/migrations");
const databaseDir = await mkdtemp(path.join(tmpdir(), "tracepoint-bootstrap-"));
const port = await localPostgresPort();
const postgres = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "local-bootstrap-only",
  port,
  persistent: false,
  postgresFlags: ["-h", "127.0.0.1"],
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: (message) => console.error(message),
});

let client;
let started = false;
try {
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  if (migrationFiles.length !== expectedMigrationCount) {
    throw new Error(
      `Expected ${expectedMigrationCount} migrations, found ${migrationFiles.length}. Update the validator when adding a migration.`,
    );
  }

  const versions = migrationFiles.map((file) => file.split("_", 1)[0]);
  if (new Set(versions).size !== versions.length) {
    throw new Error("Migration version prefixes must be unique.");
  }

  await postgres.initialise();
  await postgres.start();
  started = true;
  console.log(`Disposable PostgreSQL started; applying ${migrationFiles.length} migrations.`);
  client = postgres.getPgClient();
  await client.connect();
  await client.query("set statement_timeout = '20s'");
  await client.query(supabasePrerequisites);
  await client.query(
    "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)",
  );

  for (const file of migrationFiles) {
    console.log(`Applying ${file}`);
    const sql = (await readFile(path.join(migrationsDir, file), "utf8"))
      .replace(/^\uFEFF/, "");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into supabase_migrations.schema_migrations(version) values($1)",
        [file.split("_", 1)[0]],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      console.error(`Migration execution error in ${file}: ${error.message}`);
      throw new Error(`Clean bootstrap failed in ${file}: ${error.message}`, {
        cause: error,
      });
    }
  }

  const authorityMigration = "202609050002_granular_permission_authority.sql";
  await client.query("begin");
  await client.query(await readFile(path.join(migrationsDir, authorityMigration), "utf8"));
  await client.query("commit");

  const requiredTables = [
    "profiles", "departments", "department_memberships",
    "feature_catalog", "department_features", "department_feature_events",
    "pilot_range_workspaces",
    "equipment_types", "equipment_assets", "equipment_asset_assignments",
    "range_days", "range_day_drills", "fleet_vehicles",
    "notification_events", "training_certifications", "agency_training_events",
  ];
  const { rows } = await client.query(
    `select tablename from pg_tables where schemaname = 'public' and tablename = any($1)`,
    [requiredTables],
  );
  const found = new Set(rows.map(({ tablename }) => tablename));
  const missing = requiredTables.filter((table) => !found.has(table));
  if (missing.length) throw new Error(`Required tables missing: ${missing.join(", ")}`);

  const checks = await client.query(`
    select
      to_regclass('public.equipment_asset_assignments') is not null as equipment_history,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'equipment_types_department_normalized_name_unique'
      ) as equipment_type_uniqueness,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'equipment_types'
          and column_name = 'is_active'
      ) as equipment_type_archive,
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'range_day_drills'
          and policyname = 'range_day_drills_delete_managers'
      ) as range_drill_delete_policy,
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'equipment_asset_assignments'
          and policyname = 'equipment_assignment_history_select_scoped'
      ) as equipment_assignment_policy,
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'certification_types'
          and policyname = 'department members can view certification types'
      ) as certification_type_policy
      ,(select count(*) = 21 from public.permissions) as permission_catalog_complete
      ,exists (
        select 1 from pg_trigger
        where tgname = 'protect_final_administrator_role' and not tgisinternal
      ) as final_administrator_guard
      ,exists (
        select 1 from pg_proc
        where proname = 'has_department_permission'
          and pg_get_functiondef(oid) like '%membership_role.role_code = ''administrator''%'
      ) as administrator_inheritance
  `);
  const failedChecks = Object.entries(checks.rows[0])
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failedChecks.length) {
    throw new Error(`Focused schema checks failed: ${failedChecks.join(", ")}`);
  }

  await client.query(
    await readFile("scripts/validate-local-armory-workflows.sql", "utf8"),
  );
  await client.query(
    await readFile("scripts/validate-local-tenant-isolation.sql", "utf8"),
  );
  console.log(
    "Local armory workflows and tenant isolation passed.",
  );

  const departmentA = "10000000-0000-0000-0000-000000000001";
  const departmentB = "10000000-0000-0000-0000-000000000002";
  const users = {
    granted: "20000000-0000-0000-0000-000000000001",
    denied: "20000000-0000-0000-0000-000000000002",
    inactive: "20000000-0000-0000-0000-000000000003",
    crossTenant: "20000000-0000-0000-0000-000000000004",
    administrator: "20000000-0000-0000-0000-000000000005",
    platform: "20000000-0000-0000-0000-000000000006",
  };
  await client.query(`
    insert into auth.users (id, email) values
      ('${users.granted}', 'granted@example.test'), ('${users.denied}', 'denied@example.test'),
      ('${users.inactive}', 'inactive@example.test'), ('${users.crossTenant}', 'cross@example.test'),
      ('${users.administrator}', 'admin@example.test'), ('${users.platform}', 'platform@example.test');
    insert into public.profiles (id, full_name, email)
      select id, split_part(email, '@', 1), email from auth.users
      on conflict (id) do update set full_name=excluded.full_name, email=excluded.email;
    insert into public.departments (id, name, slug) values
      ('${departmentA}', 'Permission Audit A', 'permission-audit-a'),
      ('${departmentB}', 'Permission Audit B', 'permission-audit-b');
    insert into public.roles (code, display_name) values
      ('audit_granted', 'Audit Granted'), ('audit_denied', 'Audit Denied');
    insert into public.department_memberships (department_id, user_id, is_active) values
      ('${departmentA}', '${users.granted}', true), ('${departmentA}', '${users.denied}', true),
      ('${departmentA}', '${users.inactive}', false), ('${departmentB}', '${users.crossTenant}', true),
      ('${departmentA}', '${users.administrator}', true);
    insert into public.department_membership_roles (department_id, user_id, role_code) values
      ('${departmentA}', '${users.granted}', 'audit_granted'), ('${departmentA}', '${users.denied}', 'audit_denied'),
      ('${departmentA}', '${users.inactive}', 'audit_granted'), ('${departmentB}', '${users.crossTenant}', 'audit_granted'),
      ('${departmentA}', '${users.administrator}', 'administrator');
    insert into public.department_role_permissions (department_id, role_code, permission_code)
      values ('${departmentA}', 'audit_granted', 'manage_equipment'), ('${departmentB}', 'audit_granted', 'manage_equipment');
    insert into public.platform_admins (user_id, display_name, is_active)
      values ('${users.platform}', 'Permission Audit Platform', true);
  `);

  async function permissionAs(userId, departmentId, permissionCode) {
    await client.query("begin");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      const result = await client.query(
        "select public.has_department_permission($1, $2) as allowed",
        [departmentId, permissionCode],
      );
      await client.query("commit");
      return result.rows[0].allowed;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  const matrixChecks = {
    explicit_grant: await permissionAs(users.granted, departmentA, "manage_equipment"),
    role_without_grant: !(await permissionAs(users.denied, departmentA, "manage_equipment")),
    inactive_denied: !(await permissionAs(users.inactive, departmentA, "manage_equipment")),
    cross_tenant_denied: !(await permissionAs(users.crossTenant, departmentA, "manage_equipment")),
    administrator_inherits_current: await permissionAs(users.administrator, departmentA, "manage_equipment"),
    administrator_inherits_new: await permissionAs(users.administrator, departmentA, "approve_personal_rifles"),
    platform_not_department_member: !(await permissionAs(users.platform, departmentA, "manage_equipment")),
  };
  const failedMatrixChecks = Object.entries(matrixChecks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failedMatrixChecks.length) throw new Error(`Permission actor matrix failed: ${failedMatrixChecks.join(", ")}`);

  const catalog = (await client.query("select code from public.permissions order by code")).rows.map((row) => row.code);
  const generatedFailures = [];
  for (const permissionCode of catalog) {
    if (permissionCode !== "administer_department") {
      await client.query(
        "delete from public.department_role_permissions where role_code='audit_granted' and department_id = any($1::uuid[])",
        [[departmentA, departmentB]],
      );
      await client.query(
        "insert into public.department_role_permissions (department_id, role_code, permission_code) values ($1, 'audit_granted', $3), ($2, 'audit_granted', $3)",
        [departmentA, departmentB, permissionCode],
      );
    }
    const permissionChecks = {
      granted: permissionCode === "administer_department"
        ? await permissionAs(users.administrator, departmentA, permissionCode)
        : await permissionAs(users.granted, departmentA, permissionCode),
      without_grant: !(await permissionAs(users.denied, departmentA, permissionCode)),
      inactive: !(await permissionAs(users.inactive, departmentA, permissionCode)),
      cross_tenant: !(await permissionAs(users.crossTenant, departmentA, permissionCode)),
      administrator: await permissionAs(users.administrator, departmentA, permissionCode),
      platform_without_membership: !(await permissionAs(users.platform, departmentA, permissionCode)),
    };
    for (const [actor, passed] of Object.entries(permissionChecks)) {
      if (!passed) generatedFailures.push(`${permissionCode}:${actor}`);
    }
  }
  if (generatedFailures.length) throw new Error(`Generated permission matrix failed: ${generatedFailures.join(", ")}`);

  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [users.administrator]);
  const saved = await client.query(
    "select public.set_department_role_permissions($1, $2, $3::text[]) as permissions",
    [departmentA, "audit_denied", ["manage_training"]],
  );
  await client.query("commit");
  if (String(saved.rows[0].permissions) !== "manage_training") throw new Error("Atomic role-permission replacement was not returned for verification.");
  if (!(await permissionAs(users.denied, departmentA, "manage_training"))) throw new Error("Saved role permission was not immediately effective.");

  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [users.administrator]);
  await client.query(
    "select public.set_department_member_roles($1, $2, $3::text[])",
    [departmentA, users.administrator, ["administrator", "chief"]],
  );
  await client.query(
    "select public.set_department_member_roles($1, $2, $3::text[])",
    [departmentA, users.administrator, ["administrator"]],
  );
  await client.query("commit");

  let finalAdministratorProtected = false;
  await client.query("begin");
  try {
    await client.query("delete from public.department_membership_roles where department_id=$1 and user_id=$2 and role_code='administrator'", [departmentA, users.administrator]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    finalAdministratorProtected = error.code === "23514";
  }
  if (!finalAdministratorProtected) throw new Error("Direct database removal of the final Administrator was not blocked.");

  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [users.platform]);
  const platformSave = await client.query(
    "select public.set_department_role_permissions($1, $2, $3::text[]) as permissions",
    [departmentA, "audit_denied", ["view_audit_log"]],
  );
  await client.query("commit");
  if (String(platformSave.rows[0].permissions) !== "view_audit_log") throw new Error("Platform administrator explicit-department permission save failed.");

  const legacyPermissions = [
    "create_remediations",
    "manage_remediations",
    "resolve_remediations",
    "view_training_alerts",
    "manage_training_alerts",
    "view_command_training_alerts",
  ];
  await client.query(`
    insert into public.permissions (code, display_name, description)
    select code, initcap(replace(code, '_', ' ')), 'Disposable retirement fixture.'
    from unnest($1::text[]) as codes(code)
  `, [legacyPermissions]);
  await client.query(`
    insert into public.role_permissions (role_code, permission_code)
    select 'administrator', code from unnest($1::text[]) as codes(code)
  `, [legacyPermissions]);
  await client.query(`
    insert into public.department_role_permissions (
      department_id, role_code, permission_code
    )
    select $2::uuid, 'audit_granted', code
    from unnest($1::text[]) as codes(code)
  `, [legacyPermissions, departmentA]);

  const broaderAssignmentsBefore = Number((await client.query(`
    select
      (select count(*) from public.role_permissions
       where permission_code in ('manage_training', 'view_analytics')) +
      (select count(*) from public.department_role_permissions
       where permission_code in ('manage_training', 'view_analytics')) as count
  `)).rows[0].count);
  const retirementMigration = await readFile(
    path.join(migrationsDir, "202609060001_retire_legacy_training_alert_permissions.sql"),
    "utf8",
  );
  await client.query(retirementMigration);
  await client.query(retirementMigration);

  const retirement = await client.query(`
    select
      (select count(*)::int from public.permissions where code = any($1)) as catalog_rows,
      (select count(*)::int from public.role_permissions where permission_code = any($1)) as global_rows,
      (select count(*)::int from public.department_role_permissions where permission_code = any($1)) as department_rows,
      (select count(*)::int from public.retired_permission_assignment_audit where permission_code = any($1)) as audit_rows
  `, [legacyPermissions]);
  assert.deepEqual(retirement.rows[0], {
    catalog_rows: 0,
    global_rows: 0,
    department_rows: 0,
    audit_rows: 18,
  });
  const broaderAssignmentsAfter = Number((await client.query(`
    select
      (select count(*) from public.role_permissions
       where permission_code in ('manage_training', 'view_analytics')) +
      (select count(*) from public.department_role_permissions
       where permission_code in ('manage_training', 'view_analytics')) as count
  `)).rows[0].count);
  assert.equal(
    broaderAssignmentsAfter,
    broaderAssignmentsBefore,
    "Legacy retirement must not add or remove broader authority.",
  );

  const fixtureCount = await client.query("select count(*)::int as count from public.departments where slug like 'permission-audit-%'");
  if (fixtureCount.rows[0].count !== 2) throw new Error("Disposable permission fixture setup was incomplete.");

  if (process.argv.includes("--rehearse-restore")) {
    const binaryDir =
      process.env.TRACEPOINT_PG_BIN ||
      path.dirname(postgres.process.spawnfile);
    const suffix = process.platform === "win32" ? ".exe" : "";
    const dumpPath = path.join(databaseDir, "rehearsal.dump");
    const localEnv = {
      ...process.env,
      PGPASSWORD: "local-bootstrap-only",
    };
    const connectionArgs = [
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-U",
      "postgres",
    ];
    await execFileAsync(
      path.join(binaryDir, `pg_dump${suffix}`),
      [
        ...connectionArgs,
        "-Fc",
        "--no-owner",
        "-f",
        dumpPath,
        "postgres",
      ],
      { env: localEnv, timeout: 60_000 },
    );
    await client.query("create database tracepoint_restore");
    const startedAt = Date.now();
    await execFileAsync(
      path.join(binaryDir, `pg_restore${suffix}`),
      [
        ...connectionArgs,
        "--no-owner",
        "--exit-on-error",
        "-d",
        "tracepoint_restore",
        dumpPath,
      ],
      { env: localEnv, timeout: 60_000 },
    );
    const restored = new client.constructor({
      host: "127.0.0.1",
      port,
      user: "postgres",
      password: "local-bootstrap-only",
      database: "tracepoint_restore",
    });
    try {
      await restored.connect();
      const fingerprint = async (connection) => {
        const catalog = (await connection.query(catalogSql)).rows[0];
        const results = await connection.query(
          manifestSql(catalog, versions),
        );
        return results.find((result) => result.rows?.[0]?.manifest)
          ?.rows[0].manifest;
      };
      const before = await fingerprint(client);
      const after = await fingerprint(restored);
      assert.deepEqual(
        after,
        before,
        "Local restore full manifest reconciliation failed",
      );
      console.log(
        `Local dump/restore reconciliation passed in ${Date.now() - startedAt} ms.`,
      );
    } finally {
      await restored.end();
    }
  }

  console.log(`Clean bootstrap passed: ${migrationFiles.length} ordered migrations; permission and retirement matrices passed; disposable database removed.`);
} finally {
  if (client) await client.end().catch(() => {});
  if (started && postgres.process?.spawnfile) {
    const pgCtl = path.join(path.dirname(postgres.process.spawnfile), process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
    await execFileAsync(pgCtl, ["stop", "-D", databaseDir, "-m", "fast", "-w"], { timeout: 20000 }).catch(() => {});
    postgres.process = undefined;
  }
  await rm(databaseDir, { recursive: true, force: true }).catch(() => {});
}

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

const expectedMigrationCount = 58;
const migrationsDir = path.resolve("supabase/migrations");
const databaseDir = await mkdtemp(path.join(tmpdir(), "tracepoint-bootstrap-"));
const port = 56000 + Math.floor(Math.random() * 4000);
const postgres = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "local-bootstrap-only",
  port,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: (message) => console.error(message),
});

const supabasePrerequisites = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text not null
  );
  alter table storage.objects enable row level security;
`;

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

  for (const file of migrationFiles) {
    console.log(`Applying ${file}`);
    const sql = (await readFile(path.join(migrationsDir, file), "utf8"))
      .replace(/^\uFEFF/, "");
    try {
      await client.query("begin");
      await client.query(sql);
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

  // Reproduce the six production-only catalog rows and exercise them entirely
  // inside this disposable database. They are intentionally not migrations.
  const legacyPermissions = [
    "create_remediations",
    "manage_remediations",
    "resolve_remediations",
    "view_training_alerts",
    "manage_training_alerts",
    "view_command_training_alerts",
  ];
  const broaderByLegacyPermission = {
    create_remediations: "manage_training",
    manage_remediations: "manage_training",
    resolve_remediations: "manage_training",
    view_training_alerts: "view_analytics",
    manage_training_alerts: "manage_training",
    view_command_training_alerts: "view_analytics",
  };
  const legacyActors = {
    legacyOnly: "21000000-0000-0000-0000-000000000001",
    broaderOnly: "21000000-0000-0000-0000-000000000002",
    both: "21000000-0000-0000-0000-000000000003",
    neither: "21000000-0000-0000-0000-000000000004",
    inactive: "21000000-0000-0000-0000-000000000005",
    crossDepartment: "21000000-0000-0000-0000-000000000006",
  };

  await client.query(`
    insert into auth.users (id, email) values
      ('${legacyActors.legacyOnly}', 'legacy-only@example.test'),
      ('${legacyActors.broaderOnly}', 'broader-only@example.test'),
      ('${legacyActors.both}', 'legacy-and-broader@example.test'),
      ('${legacyActors.neither}', 'neither@example.test'),
      ('${legacyActors.inactive}', 'inactive-legacy@example.test'),
      ('${legacyActors.crossDepartment}', 'cross-department-legacy@example.test');
    insert into public.profiles (id, full_name, email)
      select id, split_part(email, '@', 1), email
      from auth.users
      where id::text like '21000000-%'
      on conflict (id) do update
      set full_name=excluded.full_name, email=excluded.email;
    insert into public.roles (code, display_name) values
      ('audit_legacy_only', 'Audit Legacy Only'),
      ('audit_broader_only', 'Audit Broader Only'),
      ('audit_legacy_and_broader', 'Audit Legacy And Broader'),
      ('audit_neither', 'Audit Neither');
    insert into public.department_memberships (department_id, user_id, is_active) values
      ('${departmentA}', '${legacyActors.legacyOnly}', true),
      ('${departmentA}', '${legacyActors.broaderOnly}', true),
      ('${departmentA}', '${legacyActors.both}', true),
      ('${departmentA}', '${legacyActors.neither}', true),
      ('${departmentA}', '${legacyActors.inactive}', false),
      ('${departmentB}', '${legacyActors.crossDepartment}', true);
    insert into public.department_membership_roles (department_id, user_id, role_code) values
      ('${departmentA}', '${legacyActors.legacyOnly}', 'audit_legacy_only'),
      ('${departmentA}', '${legacyActors.broaderOnly}', 'audit_broader_only'),
      ('${departmentA}', '${legacyActors.both}', 'audit_legacy_and_broader'),
      ('${departmentA}', '${legacyActors.neither}', 'audit_neither'),
      ('${departmentA}', '${legacyActors.inactive}', 'audit_legacy_only'),
      ('${departmentB}', '${legacyActors.crossDepartment}', 'audit_legacy_only');
    insert into public.permissions (code, display_name, description) values
      ('create_remediations', 'Create Remediations', 'Disposable production-drift fixture.'),
      ('manage_remediations', 'Manage Remediations', 'Disposable production-drift fixture.'),
      ('resolve_remediations', 'Resolve Remediations', 'Disposable production-drift fixture.'),
      ('view_training_alerts', 'View Training Alerts', 'Disposable production-drift fixture.'),
      ('manage_training_alerts', 'Manage Training Alerts', 'Disposable production-drift fixture.'),
      ('view_command_training_alerts', 'View Command Training Alerts', 'Disposable production-drift fixture.');
  `);

  for (const permissionCode of legacyPermissions) {
    const broaderPermission = broaderByLegacyPermission[permissionCode];
    await client.query(
      `insert into public.role_permissions (role_code, permission_code)
       values ('audit_legacy_only', $1)`,
      [permissionCode],
    );
    await client.query(
      `insert into public.department_role_permissions (department_id, role_code, permission_code)
       values
         ($1, 'audit_legacy_only', $3),
         ($1, 'audit_legacy_and_broader', $3),
         ($2, 'audit_legacy_only', $3)`,
      [departmentA, departmentB, permissionCode],
    );
    await client.query(
      `insert into public.department_role_permissions (department_id, role_code, permission_code)
       values
         ($1, 'audit_broader_only', $2),
         ($1, 'audit_legacy_and_broader', $2)
       on conflict do nothing`,
      [departmentA, broaderPermission],
    );

    const legacyMatrix = {
      legacy_only_legacy: await permissionAs(legacyActors.legacyOnly, departmentA, permissionCode),
      legacy_only_broader: !(await permissionAs(legacyActors.legacyOnly, departmentA, broaderPermission)),
      broader_only_legacy: !(await permissionAs(legacyActors.broaderOnly, departmentA, permissionCode)),
      broader_only_broader: await permissionAs(legacyActors.broaderOnly, departmentA, broaderPermission),
      both_legacy: await permissionAs(legacyActors.both, departmentA, permissionCode),
      both_broader: await permissionAs(legacyActors.both, departmentA, broaderPermission),
      neither_legacy: !(await permissionAs(legacyActors.neither, departmentA, permissionCode)),
      administrator_legacy: await permissionAs(users.administrator, departmentA, permissionCode),
      inactive_legacy: !(await permissionAs(legacyActors.inactive, departmentA, permissionCode)),
      cross_department_legacy: !(await permissionAs(legacyActors.crossDepartment, departmentA, permissionCode)),
    };
    const failedLegacyChecks = Object.entries(legacyMatrix)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    if (failedLegacyChecks.length) {
      throw new Error(
        `Legacy permission matrix failed for ${permissionCode}: ${failedLegacyChecks.join(", ")}`,
      );
    }
  }

  const legacyExpression = legacyPermissions.join("|");
  const directAuthorityReferences = await client.query(
    `select
      (select count(*)::int from pg_policies
       where schemaname = 'public'
         and (coalesce(qual, '') ~ $1 or coalesce(with_check, '') ~ $1)) as policy_count,
      (select count(*)::int from pg_proc
       where pronamespace = 'public'::regnamespace
         and prokind = 'f'
         and pg_get_functiondef(oid) ~ $1) as function_count`,
    [legacyExpression],
  );
  if (directAuthorityReferences.rows[0].policy_count !== 0 || directAuthorityReferences.rows[0].function_count !== 0) {
    throw new Error("Legacy permissions unexpectedly control an RLS policy or RPC.");
  }

  // Production has this pilot table with RLS enabled and no policies. Mirror
  // that metadata to prove direct authenticated reads and updates are denied
  // even when has_department_permission returns true for a legacy code.
  await client.query(`
    create table public.pilot_remediation_workspaces (
      department_id uuid primary key references public.departments(id) on delete cascade,
      remediations jsonb not null default '[]'::jsonb,
      updated_by uuid references public.profiles(id),
      updated_at timestamptz not null default now()
    );
    alter table public.pilot_remediation_workspaces enable row level security;
    grant select, insert, update on public.pilot_remediation_workspaces to authenticated;
    insert into public.pilot_remediation_workspaces (department_id, remediations)
    values ('${departmentA}', '[{"id":"disposable-remediation"}]'::jsonb);
  `);

  async function pilotRemediationAccessAs(userId) {
    await client.query("begin");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      const selected = await client.query(
        "select count(*)::int as count from public.pilot_remediation_workspaces where department_id=$1",
        [departmentA],
      );
      const updated = await client.query(
        "update public.pilot_remediation_workspaces set updated_at=now() where department_id=$1 returning department_id",
        [departmentA],
      );
      await client.query("commit");
      return { selected: selected.rows[0].count, updated: updated.rowCount };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  for (const [actor, userId] of Object.entries({
    legacyOnly: legacyActors.legacyOnly,
    broaderOnly: legacyActors.broaderOnly,
    both: legacyActors.both,
    neither: legacyActors.neither,
    administrator: users.administrator,
    inactive: legacyActors.inactive,
    crossDepartment: legacyActors.crossDepartment,
  })) {
    assert.deepEqual(
      await pilotRemediationAccessAs(userId),
      { selected: 0, updated: 0 },
      `pilot remediation direct access: ${actor}`,
    );
  }

  const proposalPath = path.resolve(
    "supabase/proposals/202609050003_retire_legacy_training_alert_permissions.sql",
  );
  const proposal = await readFile(proposalPath, "utf8");
  const canonicalAssignmentCountBefore = Number((await client.query(`
    select
      (select count(*) from public.role_permissions where permission_code in ('manage_training', 'view_analytics')) +
      (select count(*) from public.department_role_permissions where permission_code in ('manage_training', 'view_analytics'))
      as count
  `)).rows[0].count);

  await client.query(proposal);
  await client.query(proposal);

  const retirement = await client.query(`
    select
      (select count(*)::int from public.permissions where code = any($1)) as catalog_rows,
      (select count(*)::int from public.role_permissions where permission_code = any($1)) as global_rows,
      (select count(*)::int from public.department_role_permissions where permission_code = any($1)) as department_rows,
      (select count(*)::int from public.retired_permission_assignment_audit where permission_code = any($1)) as audit_rows,
      (select count(*)::int from public.retired_permission_assignment_audit where record_scope='catalog' and permission_code = any($1)) as catalog_audit_rows,
      (select count(*)::int from public.retired_permission_assignment_audit where record_scope='global_role_default' and permission_code = any($1)) as global_audit_rows,
      (select count(*)::int from public.retired_permission_assignment_audit where record_scope='department_role' and permission_code = any($1)) as department_audit_rows
  `, [legacyPermissions]);
  assert.deepEqual(retirement.rows[0], {
    catalog_rows: 0,
    global_rows: 0,
    department_rows: 0,
    audit_rows: 30,
    catalog_audit_rows: 6,
    global_audit_rows: 6,
    department_audit_rows: 18,
  });
  const canonicalAssignmentCountAfter = Number((await client.query(`
    select
      (select count(*) from public.role_permissions where permission_code in ('manage_training', 'view_analytics')) +
      (select count(*) from public.department_role_permissions where permission_code in ('manage_training', 'view_analytics'))
      as count
  `)).rows[0].count);
  if (canonicalAssignmentCountAfter !== canonicalAssignmentCountBefore) {
    throw new Error("Inactive retirement proposal changed broader permission assignments.");
  }

  const fixtureCount = await client.query("select count(*)::int as count from public.departments where slug like 'permission-audit-%'");
  if (fixtureCount.rows[0].count !== 2) throw new Error("Disposable permission fixture setup was incomplete.");

  console.log(`Clean bootstrap passed: ${migrationFiles.length} ordered migrations; canonical and six-code legacy matrices passed; inactive retirement proposal passed twice; disposable database removed.`);
} finally {
  if (client) await client.end().catch(() => {});
  if (started && postgres.process?.spawnfile) {
    const pgCtl = path.join(path.dirname(postgres.process.spawnfile), process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
    await execFileAsync(pgCtl, ["stop", "-D", databaseDir, "-m", "fast", "-w"], { timeout: 20000 }).catch(() => {});
    postgres.process = undefined;
  }
  await rm(databaseDir, { recursive: true, force: true }).catch(() => {});
}

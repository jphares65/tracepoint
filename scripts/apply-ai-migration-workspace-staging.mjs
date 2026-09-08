import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ACCOUNT = "559054714699";
const REGION = "us-east-1";
const PROJECT = "wztqqqashilusoppddxi";
const VERSION = "202609070001";
const PRIVILEGES_VERSION = "202609080001";
const PREVIOUS_MIGRATION_COUNT = 73;
const PREVIOUS_MAX_VERSION = "202609060006";
const MIGRATION_PATH = path.resolve("supabase/migrations/202609070001_ai_migration_workspaces.sql");
const PRIVILEGES_MIGRATION_PATH = path.resolve("supabase/migrations/202609080001_ai_migration_workspace_privileges.sql");

const execute = process.argv.includes("--execute");
const checkOnly = process.argv.includes("--check");
assert.notEqual(execute, checkOnly, "Choose exactly one of --check or --execute.");

const environment = {
  ...process.env,
  AWS_PROFILE: "tracepoint-member-staging",
  AWS_REGION: REGION,
  AWS_DEFAULT_REGION: REGION,
  AWS_CLI_OUTPUT_ENCODING: "UTF-8",
};
for (const key of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) delete environment[key];

function aws(args) {
  return JSON.parse(execFileSync("aws.exe", args, {
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function verifyIdentity() {
  const identity = aws(["sts", "get-caller-identity", "--region", REGION, "--output", "json"]);
  assert.equal(identity.Account, ACCOUNT);
  assert.match(identity.Arn, /^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);
}

let directory;
const query = (sql, name) => {
  directory ??= mkdtempSync(path.join(tmpdir(), "tracepoint-ai-workspace-staging-"));
  const file = path.join(directory, `${name}.sql`);
  writeFileSync(file, sql, { encoding: "utf8", flag: "wx" });
  const command = `& npx.cmd supabase db query --linked --project-ref ${PROJECT} --file '${file.replaceAll("'", "''")}' --output json; exit $LASTEXITCODE`;
  let output;
  try {
    output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    const diagnostic = String(error?.stderr ?? "Supabase query failed")
      .replaceAll(directory, "<temporary-directory>")
      .replace(/sb_(?:secret|publishable)_[A-Za-z0-9._-]+/g, "<redacted-key>")
      .slice(0, 500);
    throw new Error(diagnostic);
  }
  return JSON.parse(output).rows;
};

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const preflightSql = `
select
  (select count(*)::int from supabase_migrations.schema_migrations) as migration_count,
  (select max(version) from supabase_migrations.schema_migrations) as max_version,
  exists(select 1 from supabase_migrations.schema_migrations where version = '${VERSION}') as version_present,
  exists(select 1 from supabase_migrations.schema_migrations where version = '${PRIVILEGES_VERSION}') as privileges_version_present,
  to_regclass('public.ai_migration_workspaces') is not null as table_present,
  to_regprocedure('public.has_department_permission(uuid,text)') is not null as permission_function_present,
  to_regclass('public.departments') is not null as departments_present,
  to_regclass('auth.users') is not null as auth_users_present;
`;

let stage = "identity";
try {
  verifyIdentity();
  stage = "source-validation";
  const source = readFileSync(MIGRATION_PATH, "utf8").replace(/^\uFEFF/, "");
  const privilegesSource = readFileSync(PRIVILEGES_MIGRATION_PATH, "utf8").replace(/^\uFEFF/, "");
  assert.match(source, /^begin;\s*/i);
  assert.match(source, /commit;\s*$/i);
  assert.equal((source.match(/create table if not exists public\.ai_migration_workspaces/gi) ?? []).length, 1);
  assert.doesNotMatch(source, /\b(?:truncate|delete from|drop table|drop schema)\b/i);
  assert.match(privilegesSource, /^begin;\s*/i);
  assert.match(privilegesSource, /commit;\s*$/i);
  assert.match(privilegesSource, /grant select, insert, update, delete on table public\.ai_migration_workspaces to service_role/i);
  assert.match(privilegesSource, /notify pgrst, 'reload schema'/i);
  assert.doesNotMatch(privilegesSource, /\b(?:truncate|delete from|drop table|drop schema)\b/i);

  stage = "preflight-query";
  const before = query(preflightSql, "preflight")[0];
  const applied = [];
  if (execute && !before.version_present) {
    assert.equal(before.migration_count, PREVIOUS_MIGRATION_COUNT, "Unexpected staging migration count.");
    assert.equal(before.max_version, PREVIOUS_MAX_VERSION, "Unexpected latest staging migration.");
    assert.equal(before.table_present, false, "Workspace table exists without the expected migration ledger entry.");
    assert.equal(before.permission_function_present, true);
    assert.equal(before.departments_present, true);
    assert.equal(before.auth_users_present, true);
    verifyIdentity();
    const body = source.replace(/^begin;\s*/i, "").replace(/commit;\s*$/i, "");
    const guarded = `begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ begin
  if (select count(*) from supabase_migrations.schema_migrations) <> ${PREVIOUS_MIGRATION_COUNT}
    or (select max(version) from supabase_migrations.schema_migrations) <> '${PREVIOUS_MAX_VERSION}'
    or exists(select 1 from supabase_migrations.schema_migrations where version = '${VERSION}')
    or to_regclass('public.ai_migration_workspaces') is not null
  then raise exception 'Staging migration precondition changed';
  end if;
end $$;
${body}
insert into supabase_migrations.schema_migrations(version, name, statements)
values (${literal(VERSION)}, 'ai_migration_workspaces', array[${literal(body)}]);
commit;`;
    stage = "migration-apply";
    query(guarded, "apply");
    applied.push(VERSION);
  }

  const middle = query(preflightSql, "post-workspace-migration")[0];
  if (execute && !middle.privileges_version_present) {
    assert.equal(middle.migration_count, PREVIOUS_MIGRATION_COUNT + 1, "Unexpected staging migration count before privilege repair.");
    assert.equal(middle.max_version, VERSION, "Unexpected latest staging migration before privilege repair.");
    assert.equal(middle.version_present, true);
    assert.equal(middle.table_present, true);
    verifyIdentity();
    const privilegesBody = privilegesSource.replace(/^begin;\s*/i, "").replace(/commit;\s*$/i, "");
    const guardedPrivileges = `begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ begin
  if (select count(*) from supabase_migrations.schema_migrations) <> ${PREVIOUS_MIGRATION_COUNT + 1}
    or (select max(version) from supabase_migrations.schema_migrations) <> '${VERSION}'
    or not exists(select 1 from supabase_migrations.schema_migrations where version = '${VERSION}')
    or exists(select 1 from supabase_migrations.schema_migrations where version = '${PRIVILEGES_VERSION}')
    or to_regclass('public.ai_migration_workspaces') is null
  then raise exception 'Staging privilege migration precondition changed';
  end if;
end $$;
${privilegesBody}
insert into supabase_migrations.schema_migrations(version, name, statements)
values (${literal(PRIVILEGES_VERSION)}, 'ai_migration_workspace_privileges', array[${literal(privilegesBody)}]);
commit;`;
    stage = "privilege-migration-apply";
    query(guardedPrivileges, "apply-privileges");
    applied.push(PRIVILEGES_VERSION);
  }

  stage = "verification-query";
  const after = query(`
select
  (select count(*)::int from supabase_migrations.schema_migrations) as migration_count,
  exists(select 1 from supabase_migrations.schema_migrations where version = '${VERSION}') as version_present,
  exists(select 1 from supabase_migrations.schema_migrations where version = '${PRIVILEGES_VERSION}') as privileges_version_present,
  to_regclass('public.ai_migration_workspaces') is not null as table_present,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.ai_migration_workspaces')), false) as rls_enabled,
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'ai_migration_workspaces') as policy_count,
  to_regprocedure('public.expire_ai_migration_workspaces()') is not null as expiration_function_present,
  (select count(*) = 4 from information_schema.table_privileges where table_schema = 'public' and table_name = 'ai_migration_workspaces' and grantee = 'service_role' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')) as service_role_privileges,
  (select count(*) = 4 from information_schema.table_privileges where table_schema = 'public' and table_name = 'ai_migration_workspaces' and grantee = 'authenticated' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')) as authenticated_privileges;
`, "verification")[0];
  const workspaceRows = after.table_present
    ? query("select count(*)::int as workspace_rows from public.ai_migration_workspaces;", "workspace-row-count")[0].workspace_rows
    : null;

  if (execute || before.privileges_version_present) {
    assert.equal(after.migration_count, PREVIOUS_MIGRATION_COUNT + 2);
    assert.equal(after.version_present, true);
    assert.equal(after.privileges_version_present, true);
    assert.equal(after.table_present, true);
    assert.equal(after.rls_enabled, true);
    assert.equal(after.policy_count, 4);
    assert.equal(after.expiration_function_present, true);
    assert.equal(after.service_role_privileges, true, "service_role is missing workspace table privileges.");
    assert.equal(after.authenticated_privileges, true, "authenticated is missing workspace table privileges.");
  }

  console.log(JSON.stringify({
    target: "isolated-supabase-staging",
    project: PROJECT,
    mode: execute ? "execute" : "check",
    applied,
    before,
    after: { ...after, workspace_rows: workspaceRows },
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    privilegesSourceSha256: createHash("sha256").update(privilegesSource).digest("hex"),
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown staging operation failure";
  console.error(`AI migration workspace staging operation failed during ${stage}: ${message}`);
  process.exitCode = 1;
} finally {
  if (directory) {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.match(path.basename(resolved), /^tracepoint-ai-workspace-staging-/);
    rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

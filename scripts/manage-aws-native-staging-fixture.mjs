import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { parseBootstrapConfiguration } from "./bootstrap-aws-postgres-target-core.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const cognitoSubject = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const commit = /^[0-9a-f]{40}$/;
const reference = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,159}$/;
const syntheticEmail = /^aws-native-[a-z0-9-]+@example\.invalid$/;

const configuration = parseBootstrapConfiguration(process.env);
const input = {
  operation: process.env.TRACEPOINT_ACCEPTANCE_OPERATION,
  runId: process.env.TRACEPOINT_ACCEPTANCE_RUN_ID,
  sourceCommit: process.env.TRACEPOINT_ACCEPTANCE_SOURCE_COMMIT,
  authorizationReference: process.env.TRACEPOINT_ACCEPTANCE_AUTHORIZATION_REFERENCE,
  issuer: process.env.TRACEPOINT_ACCEPTANCE_COGNITO_ISSUER,
  manager: {
    userId: process.env.TRACEPOINT_ACCEPTANCE_MANAGER_ID,
    subject: process.env.TRACEPOINT_ACCEPTANCE_MANAGER_SUBJECT,
    email: process.env.TRACEPOINT_ACCEPTANCE_MANAGER_EMAIL,
  },
  officer: {
    userId: process.env.TRACEPOINT_ACCEPTANCE_OFFICER_ID,
    subject: process.env.TRACEPOINT_ACCEPTANCE_OFFICER_SUBJECT,
    email: process.env.TRACEPOINT_ACCEPTANCE_OFFICER_EMAIL,
  },
  foreign: {
    userId: process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_USER_ID,
    subject: process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_SUBJECT,
    email: process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_EMAIL,
  },
};

assert.ok(["setup", "cleanup"].includes(input.operation));
assert.match(input.runId ?? "", uuid);
assert.match(input.sourceCommit ?? "", commit);
assert.match(input.authorizationReference ?? "", reference);
assert.match(input.issuer ?? "", /^https:\/\/cognito-idp\.us-east-1\.amazonaws\.com\/us-east-1_[A-Za-z0-9]+$/);
for (const user of [input.manager, input.officer, input.foreign]) {
  assert.match(user.userId ?? "", uuid);
  assert.match(user.subject ?? "", cognitoSubject);
  assert.match(user.email ?? "", syntheticEmail);
}
assert.notEqual(input.manager.userId, input.foreign.userId);
assert.notEqual(input.manager.subject, input.foreign.subject);
assert.equal(new Set([input.manager.userId, input.officer.userId, input.foreign.userId]).size, 3);
assert.equal(new Set([input.manager.subject, input.officer.subject, input.foreign.subject]).size, 3);

const metadataOrigin = process.env.ECS_CONTAINER_METADATA_URI_V4;
assert.match(metadataOrigin ?? "", /^http:\/\/169\.254\.170\.2\/v4\/[A-Za-z0-9_-]+$/);
const metadata = await fetch(`${metadataOrigin}/task`, { redirect: "error", signal: AbortSignal.timeout(5000) }).then(async response => {
  assert.equal(response.status, 200);
  return response.json();
});
assert.match(metadata.TaskARN ?? "", /^arn:aws:ecs:us-east-1:559054714699:task\//);
assert.equal(metadata.Family, "tracepoint-staging-database-bootstrap");

const ca = await readFile(configuration.caPath, "utf8");
const client = new pg.Client({
  host: configuration.migrator.host,
  port: configuration.migrator.port,
  user: configuration.migrator.username,
  password: configuration.migrator.password,
  database: configuration.migrator.dbname,
  ssl: { ca, rejectUnauthorized: true },
  connectionTimeoutMillis: 10_000,
  statement_timeout: 60_000,
  application_name: "tracepoint-aws-native-acceptance-fixture",
});

const departments = {
  manager: input.manager.userId,
  foreign: input.foreign.userId,
};
const slugs = {
  manager: `aws-native-${input.runId}-manager`,
  foreign: `aws-native-${input.runId}-foreign`,
};
let stage = "connect";

try {
  await client.connect();
  stage = "lineage";
  const lineage = await client.query("select kind,count(*)::int as count from tracepoint_migrations.applied_migrations group by kind order by kind");
  assert.deepEqual(lineage.rows, [{ kind: "aws", count: 17 }, { kind: "source", count: 76 }]);
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`tracepoint:aws-native-fixture:${input.runId}`]);
  if (input.operation === "setup") {
    stage = "existing-fixture-check";
    const existing = await client.query("select count(*)::int as count from public.departments where slug=any($1::text[])", [[slugs.manager, slugs.foreign]]);
    assert.equal(existing.rows[0].count, 0, "Acceptance fixture already exists");
    for (const user of [input.manager, input.officer, input.foreign]) {
      stage = "application-user";
      await client.query(
        "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('full_name',$3::text,'identity_provider','cognito'))",
        [user.userId, user.email, user === input.manager ? "AWS Native Manager" : user === input.officer ? "Disposable acceptance officer" : "AWS Native Foreign User"],
      );
      stage = "identity-link";
      await client.query(
        "insert into public.profiles(id,full_name,email) values($1,$2,$3) on conflict(id) do update set full_name=excluded.full_name,email=excluded.email",
        [user.userId, user === input.manager ? "AWS Native Manager" : user === input.officer ? "Disposable acceptance officer" : "AWS Native Foreign User", user.email],
      );
      await client.query(
        "insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username) values('cognito',$1::text,$2::text,$3::uuid,'active',$3::uuid::text)",
        [input.issuer, user.subject, user.userId],
      );
    }
    for (const [kind, user] of [["manager", input.manager], ["foreign", input.foreign]]) {
      stage = "department";
      await client.query(
        "insert into public.departments(id,name,short_name,slug,created_by) values($1,$2,$3,$4,$5)",
        [departments[kind], kind === "manager" ? "AWS Native Acceptance" : "AWS Native Foreign", "AWS", slugs[kind], user.userId],
      );
      stage = "department-membership";
      await client.query(
        "insert into public.department_memberships(department_id,user_id,is_active,activation_status) values($1,$2,true,'activated')",
        [departments[kind], user.userId],
      );
      stage = "department-role";
      await client.query(
        "insert into public.department_membership_roles(department_id,user_id,role_code,assigned_by) values($1,$2,$3,$2)",
        [departments[kind], user.userId, kind === "manager" ? "administrator" : "officer"],
      );
      stage = "department-features";
      await client.query(
        "insert into public.department_features(department_id,feature_code,is_enabled,enabled_at,updated_by) select $1,code,true,clock_timestamp(),$2 from public.feature_catalog where is_active=true on conflict(department_id,feature_code) do update set is_enabled=true,enabled_at=excluded.enabled_at,updated_by=excluded.updated_by",
        [departments[kind], user.userId],
      );
      stage = "platform-agency-account";
      await client.query(
        "insert into public.platform_agency_accounts(department_id,account_status,plan_type,onboarding_status,created_by) values($1,'active','internal','activated',$2)",
        [departments[kind], user.userId],
      );
    }
    stage = "officer-membership";
    await client.query(
      "insert into public.department_memberships(department_id,user_id,is_active,activation_status) values($1,$2,true,'activated')",
      [departments.manager, input.officer.userId],
    );
    stage = "officer-role";
    await client.query(
      "insert into public.department_membership_roles(department_id,user_id,role_code,assigned_by) values($1,$2,'officer',$3)",
      [departments.manager, input.officer.userId, input.manager.userId],
    );
    stage = "platform-admin";
    await client.query("insert into public.platform_admins(user_id,display_name,is_active,created_by) values($1,'AWS Native Acceptance',true,$1)", [input.manager.userId]);
  } else {
    stage = "cleanup-boundary";
    const exact = await client.query("select id,slug from public.departments where id=any($1::uuid[]) order by id", [[departments.manager, departments.foreign]]);
    assert.equal(exact.rowCount, 2, "Cleanup requires the exact two fixture departments");
    assert.ok(exact.rows.every(row => [slugs.manager, slugs.foreign].includes(row.slug)));
    await client.query("select set_config('tracepoint.allow_department_teardown','on',true)");
    await client.query("delete from public.platform_admins where user_id=$1", [input.manager.userId]);
    await client.query("delete from public.departments where id=any($1::uuid[])", [[departments.manager, departments.foreign]]);
    await client.query("delete from auth.users where id=any($1::uuid[])", [[input.manager.userId, input.officer.userId, input.foreign.userId]]);
    const remaining = await client.query("select (select count(*) from public.departments where id=any($1::uuid[]))::int as departments,(select count(*) from auth.users where id=any($2::uuid[]))::int as users", [[departments.manager, departments.foreign], [input.manager.userId, input.officer.userId, input.foreign.userId]]);
    assert.deepEqual(remaining.rows[0], { departments: 0, users: 0 });
  }
  await client.query("commit");
  console.log(JSON.stringify({
    status: "PASSED",
    operation: input.operation,
    runId: input.runId,
    sourceCommit: input.sourceCommit,
    sourceMigrations: 76,
    awsMigrations: 17,
    departments: 2,
    users: 3,
    syntheticOnly: true,
    credentialsPrinted: false,
  }));
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(JSON.stringify({ status: "FAILED", operation: input.operation, stage, errorName: error?.name ?? "Error", errorCode: error?.code, table: error?.table, constraint: error?.constraint, sensitiveDetailsPrinted: false }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

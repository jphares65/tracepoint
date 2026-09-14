import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_AUTH_VALIDATION_TARGET as target,
  assertTaskOverrideSize,
  createProductionAuthFixture,
  databaseFixtureProgram,
  resolveEcsLogStreamName,
  runtimeCognitoAdminProgram,
  validateProductionAuthFixture,
} from "./production-auth-validation-core.mjs";

test("production authentication fixture is exact, unique, synthetic, and unroutable", () => {
  const fixture = createProductionAuthFixture();
  assert.equal(new Set(Object.values(fixture.users).map(user => user.userId)).size, 3);
  assert.equal(new Set(Object.values(fixture.users).map(user => user.email)).size, 3);
  assert.ok(Object.values(fixture.users).every(user => user.email.endsWith("@example.invalid")));
  assert.throws(() => validateProductionAuthFixture({ ...fixture, users: { ...fixture.users, ordinary: { ...fixture.users.ordinary, email: "person@example.com" } } }));
});

test("ECS log stream derivation is production-scoped and deterministic", () => {
  const taskArn = "arn:aws:ecs:us-east-1:193644343389:task/tracepoint-production/571d3c4fdc2b4cd9bf8dd84118a6f05b";
  assert.equal(resolveEcsLogStreamName({ taskArn, containerName: "tracepoint", streamPrefix: "web" }), "web/tracepoint/571d3c4fdc2b4cd9bf8dd84118a6f05b");
  assert.equal(resolveEcsLogStreamName({ taskArn, containerName: "tracepoint", streamPrefix: "web", reportedLogStreamName: "reported/stream" }), "reported/stream");
  assert.throws(() => resolveEcsLogStreamName({ taskArn: taskArn.replace("193644343389", "000000000000"), containerName: "tracepoint", streamPrefix: "web" }));
});

test("runtime task is pinned to one pool and suppresses all delivery", () => {
  const source = runtimeCognitoAdminProgram();
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /us-east-1_diFmWDMe9/);
  assert.match(source, /MessageAction:'SUPPRESS'/);
  assert.match(source, /AdminUserGlobalSignOut/);
  assert.match(source, /AdminDeleteUser/);
  assert.doesNotMatch(source, /ses|SendEmail|supabase|559054714699/i);
  const serialized = assertTaskOverrideSize({ containerOverrides: [{ name: "tracepoint", command: ["-e", source], environment: [
    { name: "TRACEPOINT_VALIDATION_OPERATION", value: "setup" },
    { name: "TRACEPOINT_VALIDATION_KIND", value: "ordinary" },
    { name: "TRACEPOINT_VALIDATION_RUN_ID", value: "00000000-0000-4000-8000-000000000001" },
    { name: "TRACEPOINT_VALIDATION_EMAIL", value: "aws-native-production-ordinary-00000000-0000-4000-8000-000000000001@example.invalid" },
    { name: "TRACEPOINT_VALIDATION_PUBLIC_KEY", value: "x".repeat(604) },
  ] }] });
  assert.ok(serialized.length <= 8192);
  assert.doesNotMatch(serialized, /\"command\":\[\"node\",\"-e\"/);
});

test("database task is production-bound, minimal, lineage-exact, and residue-verifying", () => {
  const source = databaseFixtureProgram("setup");
  const cleanup = databaseFixtureProgram("cleanup");
  assert.doesNotThrow(() => new Function(source));
  assert.doesNotThrow(() => new Function(cleanup));
  assert.match(source, /193644343389/);
  assert.match(source, /tracepoint-production-database-bootstrap/);
  assert.match(source, /kind:'aws',count:21/);
  assert.match(source, /kind:'source',count:76/);
  assert.match(source, /businessRows:0/);
  assert.match(source, /on conflict\(id\) do update/);
  assert.match(source, /authentication_refresh_sessions/);
  assert.match(source, /crossTenantVisible:0/);
  assert.match(cleanup, /authentication_refresh_sessions/);
  assert.match(cleanup, /authentication_flow_transactions/);
  assert.doesNotMatch(source + cleanup, /platform_admins|platform_agency_accounts|department_role_permissions|SUPABASE|559054714699/i);
  const fixture = Buffer.from(JSON.stringify(createProductionAuthFixture())).toString("base64");
  assertTaskOverrideSize({ containerOverrides: [{ name: "bootstrap", command: ["--input-type=module", "-e", source], environment: [{ name: "TRACEPOINT_VALIDATION_FIXTURE", value: fixture }] }] });
  assertTaskOverrideSize({ containerOverrides: [{ name: "bootstrap", command: ["--input-type=module", "-e", cleanup], environment: [{ name: "TRACEPOINT_VALIDATION_FIXTURE", value: fixture }] }] });
  assert.equal(target.budgetUsd, 150);
  assert.equal(target.loadBalancerDnsName, "tracep-Servi-HFH2HwVNXfys-2100776525.us-east-1.elb.amazonaws.com");
});

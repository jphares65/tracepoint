import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  createHmac,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";
import { resolve4 } from "node:dns/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  PRODUCTION_AUTH_VALIDATION_TARGET as target,
  assertTaskOverrideSize,
  createProductionAuthFixture,
  databaseFixtureProgram,
  resolveEcsLogStreamName,
  runtimeCognitoAdminProgram,
  validateProductionAuthFixture,
} from "./production-auth-validation-core.mjs";

const infraRequire = createRequire(new URL("../infra/package.json", import.meta.url));
const { AuthenticationDetails, CognitoUser, CognitoUserPool } = infraRequire("amazon-cognito-identity-js");

const authorizationReference = "owner-authorized-production-synthetic-auth-rbac-20260913";
assert.ok(process.argv.includes("--execute"), "Explicit execution flag is required.");
assert.equal(process.argv[process.argv.indexOf("--authorization-reference") + 1], authorizationReference);

function aws(args, options = {}) {
  const raw = execFileSync("aws.exe", [
    ...args,
    "--profile", target.profile,
    "--region", target.region,
    "--output", options.output ?? "json",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: options.timeout ?? 300_000, maxBuffer: 16 * 1024 * 1024 });
  return options.output === "text" ? raw.trim() : JSON.parse(raw || "null");
}

function gate() {
  const identity = aws(["sts", "get-caller-identity"]);
  assert.equal(identity.Account, target.account);
  assert.match(identity.Arn, target.rolePattern);
  return identity.Arn;
}

function stackOutputs(name) {
  const stack = aws(["cloudformation", "describe-stacks", "--stack-name", name]).Stacks?.[0];
  assert.ok(stack && ["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.StackStatus));
  return Object.fromEntries((stack.Outputs ?? []).map(item => [item.OutputKey, item.OutputValue]));
}

function imageDigest(image) {
  return image.slice(image.lastIndexOf("@") + 1);
}

async function resolveLoadBalancer(name) {
  assert.equal(name, target.loadBalancerDnsName);
  try {
    return await resolve4(name);
  } catch (error) {
    assert.ok(["ECONNREFUSED", "ETIMEOUT", "ESERVFAIL"].includes(error.code), `Unexpected DNS failure: ${error.code}`);
    const command = `(Resolve-DnsName -Name '${target.loadBalancerDnsName}' -Type A).IPAddress`;
    const raw = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", timeout: 30_000 });
    const addresses = raw.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    assert.ok(addresses.length > 0 && addresses.every(value => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)));
    return addresses;
  }
}

function writeOverride(overrides, prefix) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  const file = path.join(directory, "overrides.json");
  writeFileSync(file, assertTaskOverrideSize(overrides), { encoding: "utf8", mode: 0o600 });
  return { directory, uri: `file://${file.replaceAll("\\", "/")}` };
}

function waitForTask(taskDefinition, containerName, network, overrides, expected) {
  gate();
  const temporary = writeOverride(overrides, "tracepoint-production-auth-validation-");
  let started;
  try {
    started = aws(["ecs", "run-task", "--cluster", target.cluster, "--task-definition", taskDefinition,
      "--launch-type", "FARGATE", "--count", "1", "--network-configuration", network,
      "--started-by", "tracepoint-prod-auth-validation", "--overrides", temporary.uri]);
  } finally {
    assert.ok(temporary.directory.startsWith(path.join(tmpdir(), "tracepoint-production-auth-validation-")));
    rmSync(temporary.directory, { recursive: true, force: true });
  }
  assert.equal(started.failures?.length ?? 0, 0);
  assert.equal(started.tasks?.length, 1);
  const taskArn = started.tasks[0].taskArn;
  aws(["ecs", "wait", "tasks-stopped", "--cluster", target.cluster, "--tasks", taskArn], { timeout: 600_000 });
  const task = aws(["ecs", "describe-tasks", "--cluster", target.cluster, "--tasks", taskArn]).tasks[0];
  const container = task.containers.find(item => item.name === containerName);
  assert.equal(container.exitCode, 0, `Validation task failed at ${expected.operation}/${expected.kind ?? "database"}.`);
  assert.equal(task.taskDefinitionArn, taskDefinition);
  const streamPrefix = containerName === "tracepoint" ? "web" : "database-bootstrap";
  const logStreamName = resolveEcsLogStreamName({ taskArn, containerName, streamPrefix, reportedLogStreamName: container.logStreamName });
  let messages = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    messages = aws(["logs", "get-log-events", "--log-group-name", "/tracepoint/production/application",
      "--log-stream-name", logStreamName, "--start-from-head"]).events?.map(event => event.message) ?? [];
    if (messages.length) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  const documents = messages.map(message => { try { return JSON.parse(message); } catch { return null; } }).filter(Boolean);
  const result = documents.find(value => value.status === "PASSED" && value.operation === expected.operation && (!expected.kind || value.kind === expected.kind));
  assert.ok(result, `Sanitized evidence was not emitted for ${expected.operation}/${expected.kind ?? "database"}.`);
  return {
    result,
    taskArn,
    taskDefinitionArn: task.taskDefinitionArn,
    startedAt: task.startedAt,
    stoppedAt: task.stoppedAt,
    exitCode: container.exitCode,
    stoppedReason: task.stoppedReason,
    logStreamName,
  };
}

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.replace(/=+$/, "")) {
    const value = alphabet.indexOf(character);
    assert.ok(value >= 0);
    bits += value.toString(2).padStart(5, "0");
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(value => Number.parseInt(value, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[19] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

async function enrollMfa(user, password) {
  const memory = new Map();
  const storage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: key => memory.delete(key),
    clear: () => memory.clear(),
  };
  const pool = new CognitoUserPool({ UserPoolId: target.poolId, ClientId: target.clientId, Storage: storage, AdvancedSecurityDataCollectionFlag: false });
  const cognitoUser = new CognitoUser({ Username: user.email, Pool: pool, Storage: storage });
  let secret = "";
  await new Promise((resolvePromise, reject) => {
    const callback = {
      onSuccess: () => resolvePromise(),
      onFailure: reject,
      mfaSetup: () => cognitoUser.associateSoftwareToken({
        onFailure: reject,
        associateSecretCode: value => {
          void (async () => {
            secret = value;
            const remaining = 30_000 - Date.now() % 30_000;
            if (remaining < 5_000) await new Promise(done => setTimeout(done, remaining + 500));
            cognitoUser.verifySoftwareToken(totp(value), "TracePoint production synthetic validation", callback);
          })().catch(reject);
        },
      }),
    };
    cognitoUser.authenticateUser(new AuthenticationDetails({ Username: user.email, Password: password }), callback);
  });
  if (!secret) {
    await new Promise((resolvePromise, reject) => cognitoUser.associateSoftwareToken({
      onFailure: reject,
      associateSecretCode: value => {
        void (async () => {
          secret = value;
          const remaining = 30_000 - Date.now() % 30_000;
          if (remaining < 5_000) await new Promise(done => setTimeout(done, remaining + 500));
          cognitoUser.verifySoftwareToken(totp(value), "TracePoint production synthetic validation", { onSuccess: resolvePromise, onFailure: reject });
        })().catch(reject);
      },
    }));
  }
  await new Promise((resolvePromise, reject) => cognitoUser.setUserMfaPreference(null, { Enabled: true, PreferredMfa: true }, error => error ? reject(error) : resolvePromise()));
  memory.clear();
  assert.ok(secret);
  return secret;
}

async function signIn(context, user, password, secret) {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${target.applicationOrigin}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Continue with secure sign-in", exact: true }).click();
  await page.locator('input[name="username"]:visible').fill(user.email);
  await page.locator('input[name="password"]:visible').fill(password);
  await page.locator('input[name="password"]:visible').press("Enter");
  const code = page.locator('input:visible[name*="code" i]').first();
  await code.waitFor();
  const remaining = 30_000 - Date.now() % 30_000;
  if (remaining < 5_000) await page.waitForTimeout(remaining + 500);
  await code.fill(totp(secret));
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await page.waitForURL(url => url.origin === target.applicationOrigin && url.pathname !== "/login", { timeout: 40_000 });
  return page;
}

async function appRequest(page, route, init = {}) {
  return page.evaluate(async ({ route, init }) => {
    const response = await fetch(route, { ...init, redirect: "manual" });
    let body = null;
    try { body = await response.json(); } catch {}
    return { status: response.status, body, type: response.type };
  }, { route, init });
}

async function applicationLogout(page) {
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/auth/cognito/logout";
    document.body.append(form);
    form.submit();
  });
  await page.waitForURL(url => url.origin === "https://tracepointhq.com" && url.pathname === "/login", { timeout: 40_000 });
  const rejected = await appRequest(page, "/api/access");
  assert.equal(rejected.status, 401);
}

function objectCount(value) {
  return (value.Versions?.length ?? 0) + (value.DeleteMarkers?.length ?? 0);
}

const result = {
  format: "tracepoint-production-synthetic-auth-validation/v1",
  authorizationReference,
  account: target.account,
  region: target.region,
  validationStartedAt: new Date().toISOString(),
  productionModified: false,
  customerDataRead: false,
  customerDataModified: false,
  emailSent: 0,
  syntheticObjectsCreated: 0,
  tasks: [],
  checks: {},
  cleanup: { complete: false },
};

const fixture = createProductionAuthFixture();
fixture.issuer = target.issuer;
fixture.startedAtEpoch = Math.floor(Date.now() / 1000) - 60;
const cleanupPlan = {
  cognito: Object.values(fixture.users).map(user => ({ kind: user.kind, selector: "exact run-scoped example.invalid alias", operations: ["AdminUserGlobalSignOut", "AdminDeleteUser", "AdminGetUser absence check"] })),
  database: ["two exact run-scoped departments", "three exact user/profile/identity mappings", "three memberships", "three membership roles", "two feature rows", "run-window authentication transactions/sessions"],
  objects: "none permitted; S3 version count must remain unchanged",
};
result.fixturePlan = { users: 3, departments: 2, memberships: 3, roles: 3, features: 2, businessRows: 0, emails: "RFC-reserved example.invalid only", delivery: "AdminCreateUser MessageAction SUPPRESS", cleanupPlan };

let databaseCreated = false;
let browser;
let databaseNetwork = "";
let runtimeNetwork = "";
let storageBucket = "";
let beforeObjects = 0;
const passwords = new Map();
const mfaSecrets = new Map();
const setupTasks = [];
const cleanupTasks = [];
const attemptedKinds = new Set();

try {
  result.assumedRoleArn = gate();
  const budget = aws(["budgets", "describe-budget", "--account-id", target.account, "--budget-name", target.budgetName]).Budget;
  assert.equal(Number(budget.BudgetLimit.Amount), target.budgetUsd);
  assert.equal(budget.BudgetLimit.Unit, "USD");
  result.budget = { limitUsd: target.budgetUsd, actualUsd: Number(budget.CalculatedSpend.ActualSpend.Amount), changed: false };

  const cognito = stackOutputs("tracepoint-production-full-aws-cognito");
  assert.equal(cognito.UserPoolId, target.poolId);
  assert.equal(cognito.ClientId, target.clientId);
  assert.equal(cognito.ManagedDomain, target.managedLoginOrigin);
  const pool = aws(["cognito-idp", "describe-user-pool", "--user-pool-id", target.poolId]).UserPool;
  const appClient = aws(["cognito-idp", "describe-user-pool-client", "--user-pool-id", target.poolId, "--client-id", target.clientId]).UserPoolClient;
  assert.equal(pool.EstimatedNumberOfUsers, 0);
  assert.equal(pool.MfaConfiguration, "ON");
  assert.deepEqual(appClient.CallbackURLs, [`${target.applicationOrigin}/api/auth/cognito/callback`]);
  assert.equal(appClient.EnableTokenRevocation, true);
  assert.equal(appClient.RefreshTokenRotation?.Feature, "ENABLED");
  assert.equal(appClient.ClientSecret, undefined);
  assert.equal(aws(["cognito-idp", "list-users", "--user-pool-id", target.poolId, "--limit", "60"]).Users.length, 0);

  const service = aws(["ecs", "describe-services", "--cluster", target.cluster, "--services", target.service]).services[0];
  assert.equal(service.taskDefinition, target.runtimeTaskDefinition);
  assert.deepEqual([service.desiredCount, service.runningCount, service.pendingCount], [1, 1, 0]);
  const runtimeDefinition = aws(["ecs", "describe-task-definition", "--task-definition", target.runtimeTaskDefinition]).taskDefinition;
  const runtimeContainer = runtimeDefinition.containerDefinitions.find(item => item.name === "tracepoint");
  assert.equal(imageDigest(runtimeContainer.image), target.runtimeImageDigest);
  assert.equal(runtimeDefinition.taskRoleArn, "arn:aws:iam::193644343389:role/tracepoint-production-aws-native-ecs-task");
  const databaseDefinition = aws(["ecs", "describe-task-definition", "--task-definition", target.databaseTaskDefinition]).taskDefinition;
  const databaseContainer = databaseDefinition.containerDefinitions.find(item => item.name === "bootstrap");
  assert.equal(imageDigest(databaseContainer.image), target.databaseImageDigest);

  const runtimeNetworkConfiguration = service.networkConfiguration.awsvpcConfiguration;
  assert.equal(runtimeNetworkConfiguration.assignPublicIp, "ENABLED");
  runtimeNetwork = `awsvpcConfiguration={subnets=[${runtimeNetworkConfiguration.subnets.join(",")}],securityGroups=[${runtimeNetworkConfiguration.securityGroups.join(",")}],assignPublicIp=ENABLED}`;
  const databaseOutputs = stackOutputs("tracepoint-production-database-bootstrap");
  assert.equal(databaseOutputs.TaskDefinitionArn, target.databaseTaskDefinition);
  const databaseSubnets = databaseOutputs.PublicSubnetIds.split(",");
  assert.equal(databaseSubnets.length, 2);
  databaseNetwork = `awsvpcConfiguration={subnets=[${databaseSubnets.join(",")}],securityGroups=[${databaseOutputs.RunnerSecurityGroupId}],assignPublicIp=ENABLED}`;

  const storage = stackOutputs("tracepoint-production-full-aws-storage");
  storageBucket = storage.PrivateBucketName;
  beforeObjects = objectCount(aws(["s3api", "list-object-versions", "--bucket", storageBucket, "--max-items", "1000"]));
  const beforeSend = Number(aws(["sesv2", "get-account"]).SendQuota?.SentLast24Hours ?? 0);
  result.preflight = { cognitoUsers: 0, databaseLineage: "76+21 required by task", s3ObjectVersions: beforeObjects, sesSentLast24Hours: beforeSend, runtimeTaskDefinition: target.runtimeTaskDefinition, databaseTaskDefinition: target.databaseTaskDefinition };

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const publicKeyEncoded = Buffer.from(publicKey).toString("base64");
  for (const user of Object.values(fixture.users)) {
    attemptedKinds.add(user.kind);
    result.productionModified = true;
    const overrides = { containerOverrides: [{ name: "tracepoint", command: ["-e", runtimeCognitoAdminProgram()], environment: [
      { name: "TRACEPOINT_VALIDATION_OPERATION", value: "setup" },
      { name: "TRACEPOINT_VALIDATION_KIND", value: user.kind },
      { name: "TRACEPOINT_VALIDATION_RUN_ID", value: fixture.runId },
      { name: "TRACEPOINT_VALIDATION_EMAIL", value: user.email },
      { name: "TRACEPOINT_VALIDATION_PUBLIC_KEY", value: publicKeyEncoded },
    ] }] };
    const task = waitForTask(target.runtimeTaskDefinition, "tracepoint", runtimeNetwork, overrides, { operation: "setup", kind: user.kind });
    setupTasks.push(task);
    user.username = task.result.username;
    user.subject = task.result.subject;
    const password = privateDecrypt({ key: privateKey, oaepHash: "sha256" }, Buffer.from(task.result.sealedPassword, "base64")).toString();
    assert.ok(password.length >= 14 && password.length <= 256);
    passwords.set(user.kind, password);
    delete task.result.sealedPassword;
  }
  validateProductionAuthFixture(fixture);
  assert.equal(aws(["cognito-idp", "list-users", "--user-pool-id", target.poolId, "--limit", "60"]).Users.length, 3);

  for (const user of Object.values(fixture.users)) mfaSecrets.set(user.kind, await enrollMfa(user, passwords.get(user.kind)));
  result.checks.cognitoAuthentication = "three users authenticated with password and enrolled mandatory software-token MFA";

  const databaseFixture = Buffer.from(JSON.stringify({ ...fixture, operation: "setup" })).toString("base64");
  const databaseSetup = waitForTask(target.databaseTaskDefinition, "bootstrap", databaseNetwork, {
    containerOverrides: [{ name: "bootstrap", command: ["--input-type=module", "-e", databaseFixtureProgram("setup")], environment: [
      { name: "TRACEPOINT_VALIDATION_FIXTURE", value: databaseFixture },
    ] }],
  }, { operation: "setup" });
  result.tasks.push(databaseSetup);
  databaseCreated = true;
  result.checks.databaseFixture = databaseSetup.result;

  const runtimeStack = stackOutputs("tracepoint-production-runtime");
  const albDns = runtimeStack.LoadBalancerDnsName;
  const addresses = await resolveLoadBalancer(albDns);
  assert.ok(addresses.length > 0);
  browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP tracepointhq.com ${addresses[0]}`] });
  const providerViolations = [];
  const contextFor = async () => {
    const context = await browser.newContext();
    context.on("request", request => {
      const hostname = new URL(request.url()).hostname.toLowerCase();
      if (hostname.includes("supabase") || hostname.includes("vercel") || hostname.includes("brevo")) providerViolations.push(hostname);
    });
    return context;
  };

  const adminContext = await contextFor();
  const adminPage = await signIn(adminContext, fixture.users.admin, passwords.get("admin"), mfaSecrets.get("admin"));
  const adminAccess = await appRequest(adminPage, "/api/access");
  assert.equal(adminAccess.status, 200);
  assert.equal(adminAccess.body.access.departmentId, fixture.users.admin.userId);
  assert.ok(adminAccess.body.access.permissions.includes("administer_department"));
  const adminRoute = await appRequest(adminPage, "/api/settings/ai-importer/workspaces");
  assert.equal(adminRoute.status, 200);
  const refresh = await appRequest(adminPage, "/api/auth/cognito/refresh", { method: "POST" });
  assert.equal(refresh.status, 200);
  assert.equal(refresh.body.code, "session_refreshed");
  assert.equal((await appRequest(adminPage, "/api/access")).status, 200);
  await applicationLogout(adminPage);
  await adminContext.close();
  result.checks.admin = { login: true, session: true, administerDepartment: true, privilegedRead: true, refreshRotation: true, logout: true, revokedSessionRejected: true };

  const ordinaryContext = await contextFor();
  const ordinaryPage = await signIn(ordinaryContext, fixture.users.ordinary, passwords.get("ordinary"), mfaSecrets.get("ordinary"));
  const ordinaryAccess = await appRequest(ordinaryPage, "/api/access");
  assert.equal(ordinaryAccess.status, 200);
  assert.equal(ordinaryAccess.body.access.departmentId, fixture.users.admin.userId);
  assert.ok(!ordinaryAccess.body.access.permissions.includes("administer_department"));
  assert.equal((await appRequest(ordinaryPage, "/api/equipment/types")).status, 200);
  assert.equal((await appRequest(ordinaryPage, "/api/settings/ai-importer/workspaces")).status, 403);
  const signoutTask = waitForTask(target.runtimeTaskDefinition, "tracepoint", runtimeNetwork, {
    containerOverrides: [{ name: "tracepoint", command: ["-e", runtimeCognitoAdminProgram()], environment: [
      { name: "TRACEPOINT_VALIDATION_OPERATION", value: "global-signout" },
      { name: "TRACEPOINT_VALIDATION_KIND", value: "ordinary" },
      { name: "TRACEPOINT_VALIDATION_RUN_ID", value: fixture.runId },
      { name: "TRACEPOINT_VALIDATION_EMAIL", value: fixture.users.ordinary.email },
    ] }],
  }, { operation: "global-signout", kind: "ordinary" });
  result.tasks.push(signoutTask);
  const revokedRefresh = await appRequest(ordinaryPage, "/api/auth/cognito/refresh", { method: "POST" });
  assert.equal(revokedRefresh.status, 401);
  assert.equal((await appRequest(ordinaryPage, "/api/access")).status, 401);
  await ordinaryContext.close();
  result.checks.ordinary = { login: true, session: true, ordinaryRead: true, privilegedReadDenied: true, globalSignOut: true, revokedRefreshRejected: true, revokedSessionRejected: true };

  const foreignContext = await contextFor();
  const foreignPage = await signIn(foreignContext, fixture.users.foreign, passwords.get("foreign"), mfaSecrets.get("foreign"));
  const foreignAccess = await appRequest(foreignPage, "/api/access");
  assert.equal(foreignAccess.status, 200);
  assert.equal(foreignAccess.body.access.departmentId, fixture.users.foreign.userId);
  await foreignContext.addCookies([{ name: "tracepoint_department_id", value: fixture.users.admin.userId, url: target.applicationOrigin }]);
  const crossTenant = await appRequest(foreignPage, "/api/access");
  assert.equal(crossTenant.status, 200);
  assert.equal(crossTenant.body.access.departmentId, fixture.users.foreign.userId);
  assert.equal((await appRequest(foreignPage, "/api/settings/ai-importer/workspaces")).status, 403);
  await applicationLogout(foreignPage);
  await foreignContext.close();
  assert.deepEqual(providerViolations, []);
  result.checks.foreign = { login: true, ownTenantResolved: true, forgedDepartmentCookieIgnored: true, privilegedReadDenied: true, logout: true };
  result.checks.providerIsolation = true;
  result.applicationValidated = true;

  const afterSend = Number(aws(["sesv2", "get-account"]).SendQuota?.SentLast24Hours ?? 0);
  assert.equal(afterSend, beforeSend);
  result.emailSent = 0;
  result.checks.sesSendCounterUnchanged = true;
} finally {
  await browser?.close().catch(() => {});
  passwords.clear();
  mfaSecrets.clear();
  if (databaseCreated) {
    const cleanupFixture = Buffer.from(JSON.stringify({ ...fixture, operation: "cleanup" })).toString("base64");
    try {
      const databaseCleanup = waitForTask(target.databaseTaskDefinition, "bootstrap", databaseNetwork, {
        containerOverrides: [{ name: "bootstrap", command: ["--input-type=module", "-e", databaseFixtureProgram("cleanup")], environment: [
          { name: "TRACEPOINT_VALIDATION_FIXTURE", value: cleanupFixture },
        ] }],
      }, { operation: "cleanup" });
      cleanupTasks.push(databaseCleanup);
      result.cleanup.database = databaseCleanup.result;
    } catch (error) {
      result.cleanup.database = { status: "FAILED", errorName: error.name };
    }
  }
  for (const user of Object.values(fixture.users).reverse().filter(user => attemptedKinds.has(user.kind))) {
    try {
      const task = waitForTask(target.runtimeTaskDefinition, "tracepoint", runtimeNetwork, {
        containerOverrides: [{ name: "tracepoint", command: ["-e", runtimeCognitoAdminProgram()], environment: [
          { name: "TRACEPOINT_VALIDATION_OPERATION", value: "cleanup" },
          { name: "TRACEPOINT_VALIDATION_KIND", value: user.kind },
          { name: "TRACEPOINT_VALIDATION_RUN_ID", value: fixture.runId },
          { name: "TRACEPOINT_VALIDATION_EMAIL", value: user.email },
        ] }],
      }, { operation: "cleanup", kind: user.kind });
      cleanupTasks.push(task);
    } catch (error) {
      cleanupTasks.push({ status: "FAILED", kind: user.kind, errorName: error.name });
    }
  }
  result.tasks.push(...setupTasks.map(task => ({ ...task, result: { ...task.result, sealedPassword: undefined } })), ...cleanupTasks);
  const finalUsers = aws(["cognito-idp", "list-users", "--user-pool-id", target.poolId, "--limit", "60"]).Users.length;
  const finalObjects = storageBucket ? objectCount(aws(["s3api", "list-object-versions", "--bucket", storageBucket, "--max-items", "1000"])) : 0;
  result.cleanup.cognitoUsers = finalUsers;
  result.cleanup.syntheticObjects = finalObjects;
  result.cleanup.complete = (!databaseCreated || result.cleanup.database?.status === "PASSED") && finalUsers === 0 && (!storageBucket || finalObjects === beforeObjects) && cleanupTasks.every(task => task.result?.status === "PASSED");
  result.validationStoppedAt = new Date().toISOString();
  console.log(JSON.stringify(result, (_key, value) => value === undefined ? undefined : value, 2));
  assert.equal(result.cleanup.complete, true, "Mandatory synthetic cleanup did not complete.");
}

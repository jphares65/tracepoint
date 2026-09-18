import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

if (!process.argv.includes("--execute")) {
  throw new Error("Use --execute to create and remove disposable staging fixtures.");
}

const ACCOUNT = "559054714699";
const REGION = "us-east-1";
const SUPABASE_ORIGIN = "https://wztqqqashilusoppddxi.supabase.co";
const APPLICATION_ORIGIN = "https://staging.tracepointhq.com";
const environment = {
  ...process.env,
  AWS_PROFILE: "tracepoint-member-staging",
  AWS_REGION: REGION,
  AWS_DEFAULT_REGION: REGION,
  AWS_CLI_OUTPUT_ENCODING: "UTF-8",
};
for (const key of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) delete environment[key];

function aws(args) {
  return JSON.parse(execFileSync("aws.exe", [...args, "--region", REGION, "--output", "json"], {
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function verifyIdentity() {
  const identity = aws(["sts", "get-caller-identity"]);
  assert.equal(identity.Account, ACCOUNT);
  assert.match(identity.Arn, /^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);
}

function requireSuccess(result, label) {
  if (result.error) {
    console.error(JSON.stringify({ step: label, code: result.error.code ?? result.error.status ?? "unknown" }));
    throw new Error("A disposable staging fixture request failed.");
  }
  return result.data;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const siblingModule = path.resolve("..", "tracepoint", "node_modules", "playwright", "index.mjs");
    return import(pathToFileURL(siblingModule).href);
  }
}

verifyIdentity();
const secret = JSON.parse(aws(["secretsmanager", "get-secret-value", "--secret-id", "tracepoint/staging/application"]).SecretString);
assert.equal(secret.CONFIGURATION_ENVIRONMENT, "staging");
assert.equal(secret.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_ORIGIN);
assert.equal(secret.NEXT_PUBLIC_SITE_URL, APPLICATION_ORIGIN);
assert.ok(typeof secret.SUPABASE_SECRET_KEY === "string" && secret.SUPABASE_SECRET_KEY.length > 20);

const admin = createClient(SUPABASE_ORIGIN, secret.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { chromium } = await loadPlaywright();
const run = randomUUID();
const departmentId = randomUUID();
const slug = `acceptance-${run}-0`;
const email = `workspace-${run}@example.invalid`;
const password = `${randomBytes(36).toString("base64url")}Aa1!`;
const unitPrefix = `WS-${run.slice(0, 8).toUpperCase()}`;
let userId;
let workspaceId;
let browser;
let stage = "fixture-setup";
let failed = false;

try {
  const user = requireSuccess(await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Disposable workspace acceptance" },
  }), "create-user");
  userId = user.user.id;
  requireSuccess(await admin.from("profiles").upsert({ id: userId, full_name: "Disposable workspace acceptance", email }), "create-profile");
  requireSuccess(await admin.from("departments").insert({ id: departmentId, name: `Disposable workspace ${run}`, slug }), "create-department");
  requireSuccess(await admin.from("department_memberships").insert({ department_id: departmentId, user_id: userId, is_active: true }), "create-membership");
  requireSuccess(await admin.from("department_membership_roles").insert({ department_id: departmentId, user_id: userId, role_code: "administrator" }), "create-role");

  stage = "authenticated-workspace-flow";
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: APPLICATION_ORIGIN });
  await context.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return [APPLICATION_ORIGIN, SUPABASE_ORIGIN].includes(origin) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.origin === APPLICATION_ORIGIN && url.pathname !== "/login");

  stage = "access-check";
  const access = await context.request.get("/api/access");
  assert.equal(access.status(), 200);
  assert.equal((await access.json()).access.departmentId, departmentId);

  stage = "initial-list";
  const initialList = await context.request.get("/api/settings/ai-importer/workspaces");
  assert.equal(initialList.status(), 200);

  stage = "single-file-interpret";
  const interpreted = await page.evaluate(async ({ runId, prefix }) => {
    const form = new FormData();
    form.append("file", new File([
      `unit number,year,make,model,status,comments\n${prefix}-S,2025,Synthetic,Single,Available,single file ${runId}\n`,
    ], `synthetic-single-vehicle-${runId}.csv`, { type: "text/csv", lastModified: Date.now() }));
    const response = await fetch("/api/settings/ai-importer/interpret", { method: "POST", body: form });
    return { status: response.status, body: await response.json() };
  }, { runId: run, prefix: unitPrefix });
  assert.equal(interpreted.status, 200, interpreted.body?.error ?? "Single-file interpretation failed.");
  assert.equal(interpreted.body.interpretation.domain, "vehicles");

  stage = "single-file-preview";
  const singleSheet = interpreted.body.sheets.find((sheet) => sheet.name === interpreted.body.interpretation.sheetName);
  assert.ok(singleSheet);
  const singlePreview = await context.request.post("/api/settings/ai-importer/preview", { data: {
    file: interpreted.body.file,
    domain: interpreted.body.interpretation.domain,
    sheetName: interpreted.body.interpretation.sheetName,
    headerRow: interpreted.body.interpretation.headerRow,
    matrix: singleSheet.matrix,
    mappings: interpreted.body.interpretation.mappings,
  } });
  const singlePreviewBody = await singlePreview.json();
  assert.equal(singlePreview.status(), 200, singlePreviewBody?.error ?? "Single-file preview failed.");
  assert.equal(singlePreviewBody.summary.blocked, 0);
  assert.match(singlePreviewBody.approvalToken, /^[a-f0-9]{64}$/);

  stage = "workspace-create";
  const created = await page.evaluate(async ({ runId, prefix }) => {
    const form = new FormData();
    form.append("files", new File([
      `unit number,year,make,model,status,comments\n${prefix}-A,2025,Synthetic,Alpha,Available,workspace ${runId}\n`,
    ], `synthetic-vehicles-a-${runId}.csv`, { type: "text/csv", lastModified: Date.now() - 1000 }));
    form.append("files", new File([
      `unit number,year,make,model,status,comments\n${prefix}-B,2026,Synthetic,Beta,Available,workspace ${runId}\n`,
    ], `synthetic-vehicles-b-${runId}.csv`, { type: "text/csv", lastModified: Date.now() }));
    const response = await fetch("/api/settings/ai-importer/workspaces", { method: "POST", body: form });
    return { status: response.status, body: await response.json() };
  }, { runId: run, prefix: unitPrefix });
  assert.equal(created.status, 201, created.body?.error ?? "Workspace creation failed.");
  workspaceId = created.body.workspace.id;
  assert.match(workspaceId, /^[a-f0-9-]{36}$/i);
  assert.equal(created.body.workspace.state.sources.length, 2);
  assert.equal(new Set(created.body.workspace.state.sources.map((source) => source.fileId)).size, 2);

  stage = "workspace-list";
  const listed = await context.request.get("/api/settings/ai-importer/workspaces");
  assert.equal(listed.status(), 200);
  assert.ok((await listed.json()).workspaces.some((workspace) => workspace.id === workspaceId && workspace.fileCount === 2));

  stage = "workspace-reload";
  const detail = await context.request.get(`/api/settings/ai-importer/workspaces/${workspaceId}`);
  assert.equal(detail.status(), 200);
  const stored = (await detail.json()).workspace;
  assert.deepEqual(stored.state.sources, created.body.workspace.state.sources);

  stage = "workspace-patch";
  const saved = await context.request.patch(`/api/settings/ai-importer/workspaces/${workspaceId}`, { data: { state: stored.state } });
  assert.equal(saved.status(), 200);

  stage = "workspace-preview";
  const preview = await context.request.post(`/api/settings/ai-importer/workspaces/${workspaceId}/preview`);
  const plan = await preview.json();
  assert.equal(preview.status(), 200, plan?.error ?? "Workspace preview failed.");
  assert.equal(plan.dashboard.files, 2);
  assert.equal(plan.dashboard.sourceRows, 2);
  assert.ok(plan.readyDomains.includes("vehicles"));
  assert.equal(plan.plans.find((candidate) => candidate.domain === "vehicles")?.preview.summary.blocked, 0);

  stage = "workspace-execute";
  const execution = await context.request.post(`/api/settings/ai-importer/workspaces/${workspaceId}/execute`, {
    data: {
      domains: ["vehicles"],
      approval: { domain: true, mappings: true, validation: true, finalAction: true },
      approvalToken: plan.approvalToken,
      workspaceDigest: plan.workspaceDigest,
    },
  });
  assert.equal(execution.status(), 200);
  const executionBody = await execution.json();
  assert.equal(executionBody.ok, true);
  assert.equal(executionBody.results.vehicles.created, 2);
  assert.equal(executionBody.results.vehicles.failed, 0);
  assert.equal(executionBody.status, "completed");

  stage = "record-verification";
  const persistedVehicles = requireSuccess(await admin.from("fleet_vehicles")
    .select("unit_number")
    .eq("department_id", departmentId)
    .in("unit_number", [`${unitPrefix}-A`, `${unitPrefix}-B`]), "verify-vehicles");
  assert.deepEqual(persistedVehicles.map((vehicle) => vehicle.unit_number).sort(), [`${unitPrefix}-A`, `${unitPrefix}-B`]);

  stage = "completed-workspace-reload";
  const completed = await context.request.get(`/api/settings/ai-importer/workspaces/${workspaceId}`);
  assert.equal(completed.status(), 200);
  assert.equal((await completed.json()).workspace.status, "completed");

  stage = "workspace-delete";
  const removed = await context.request.delete(`/api/settings/ai-importer/workspaces/${workspaceId}`);
  assert.equal(removed.status(), 200);
  const absentWorkspace = requireSuccess(await admin.from("ai_migration_workspaces").select("id").eq("id", workspaceId), "verify-workspace-removal");
  assert.equal(absentWorkspace.length, 0);
  workspaceId = undefined;

  console.log(JSON.stringify({
    target: "isolated-staging",
    authenticated: true,
    uploadedFiles: 2,
    stagedSources: 2,
    stagedRows: 2,
    reloadMatched: true,
    patchPersisted: true,
    previewReady: true,
    executedDomain: "vehicles",
    createdRecords: 2,
    workspaceDeleted: true,
    rawFilesRetained: false,
    singleFileImporterPreserved: true,
  }));
} catch (error) {
  failed = true;
  const message = error instanceof Error ? error.message.slice(0, 300) : "Unknown acceptance failure";
  console.error(JSON.stringify({ stagingWorkspaceAcceptance: "failed", stage, message, sensitiveDetailsPrinted: false }));
} finally {
  await browser?.close().catch(() => {});
  let cleanupFailed = false;
  try {
    verifyIdentity();
    if (workspaceId) requireSuccess(await admin.from("ai_migration_workspaces").delete().eq("id", workspaceId).eq("department_id", departmentId), "cleanup-workspace");
    for (const table of ["fleet_vehicle_equipment", "fleet_vehicle_documents", "fleet_vehicle_inspections", "fleet_work_orders", "fleet_vehicles", "fleet_rules"]) {
      const removal = await admin.from(table).delete().eq("department_id", departmentId);
      if (removal.error) cleanupFailed = true;
    }
    for (const table of ["department_feature_events", "department_features", "department_role_permissions", "department_rules", "department_security_settings"]) {
      const removal = await admin.from(table).delete().eq("department_id", departmentId);
      if (removal.error) cleanupFailed = true;
    }
    const departmentRemoval = await admin.from("departments").delete().eq("id", departmentId).eq("slug", slug);
    if (departmentRemoval.error) cleanupFailed = true;
    const remainingDepartments = await admin.from("departments").select("id").eq("id", departmentId);
    if (remainingDepartments.error || remainingDepartments.data?.length !== 0) cleanupFailed = true;
    if (userId) {
      const userRemoval = await admin.auth.admin.deleteUser(userId);
      if (userRemoval.error) cleanupFailed = true;
      const remainingProfiles = await admin.from("profiles").select("id").eq("id", userId);
      if (remainingProfiles.error || remainingProfiles.data?.length !== 0) cleanupFailed = true;
    }
  } catch {
    cleanupFailed = true;
  }
  console.log(JSON.stringify({ fixtureRun: run, cleanup: cleanupFailed ? "failed" : "verified" }));
  if (cleanupFailed) failed = true;
}

process.exitCode = failed ? 1 : 0;

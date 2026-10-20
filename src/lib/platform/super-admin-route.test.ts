import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = "src/app/api/super-admin/route.ts";

test("postgres-mode entitlement reads and writes use the platform administrator functions", async () => {
  const route = await readFile(routePath, "utf8");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function PATCH"));
  const patch = route.slice(route.indexOf("export async function PATCH"));
  const postgresBranch = 'if (process.env.TRACEPOINT_DATA_PROVIDER === "postgres") {';

  // The postgres branch is taken before the tenant-scoped access and the
  // direct department_features upsert that authenticated cannot perform.
  assert.ok(get.indexOf(postgresBranch) >= 0 && get.indexOf(postgresBranch) < get.indexOf("resolveSuperAdmin()"));
  assert.ok(patch.indexOf(postgresBranch) >= 0 && patch.indexOf(postgresBranch) < patch.indexOf(".upsert("));
  assert.match(get, /platform\.repository\.listEntitlements\(\)/);
  assert.match(patch, /postgresPatch\(request, platform\.repository\)/);

  const postgresPatch = route.slice(route.indexOf("async function postgresPatch"), route.indexOf("async function resolveSuperAdmin"));
  assert.match(postgresPatch, /repository\.setEntitlement\(\{ departmentId, featureCode, isEnabled, reason \}\)/);
  assert.doesNotMatch(postgresPatch, /department_features|department_feature_events/);
  assert.match(postgresPatch, /typeof body\.isEnabled !== "boolean"/);
  assert.match(postgresPatch, /"P0002"[\s\S]*status: 404/);
  assert.match(route, /resolvePlatformAdminAccess\(\)/);
});

test("supabase-mode entitlement writes keep the existing service-role path", async () => {
  const route = await readFile(routePath, "utf8");
  const patch = route.slice(route.indexOf("export async function PATCH"));
  assert.match(patch, /\.from\("department_features"\)\s*\.upsert\(/);
  assert.match(patch, /\.from\("department_feature_events"\)\s*\.insert\(/);
});

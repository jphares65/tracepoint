import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = "src/app/api/super-admin/route.ts";

// Every provider goes through the platform administrator repository (its
// functions), never a direct department_features write that authenticated
// cannot perform.
test("entitlement reads and writes use the platform administrator repository", async () => {
  const route = await readFile(routePath, "utf8");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function PATCH"));
  const patch = route.slice(route.indexOf("export async function PATCH"));
  assert.match(get, /resolvePlatformAdminAccess\(\)/);
  assert.match(get, /access\.repository\.listEntitlements\(\)/);
  assert.match(patch, /resolvePlatformAdminAccess\(\)/);
  assert.match(patch, /access\.repository\.setEntitlement\(\{/);
  assert.match(patch, /typeof body\.isEnabled !== "boolean"/);
  assert.doesNotMatch(route, /from\("department_features"\)|from\("department_feature_events"\)/);
});

test("entitlement errors map to 404/403 and never return database messages (ADM-32)", async () => {
  const route = await readFile(routePath, "utf8");
  const patch = route.slice(route.indexOf("export async function PATCH"));
  assert.match(patch, /code === "P0002" \|\| code === "22P02"[\s\S]*status: 404/);
  assert.match(patch, /code === "42501" \? 403 : 500/);
  assert.match(route, /unexpectedErrorResponse\(/);
  assert.doesNotMatch(route, /error\.message/);
});

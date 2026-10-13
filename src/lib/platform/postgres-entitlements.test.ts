import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  listPostgresPlatformEntitlements,
  setPostgresPlatformEntitlement,
} from "./postgres-entitlements.ts";

test("Super Admin entitlement reads use the platform-scoped PostgreSQL function", async () => {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const payload = {
    departments: [{ id: "agency-a" }, { id: "agency-b" }],
    features: [{ code: "fleet", is_active: true }],
    entitlements: [{ department_id: "agency-a", feature_code: "fleet", is_enabled: false }],
  };
  const result = await listPostgresPlatformEntitlements(async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ value: payload }] };
  });

  assert.deepEqual(result, payload);
  assert.deepEqual(calls, [{ sql: "select public.get_platform_entitlements() as value", values: undefined }]);
});

test("Super Admin entitlement writes use the guarded atomic PostgreSQL function", async () => {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  await setPostgresPlatformEntitlement(async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [] };
  }, {
    departmentId: "agency-b",
    featureCode: "fleet",
    isEnabled: false,
    reason: "Agency exception",
  });

  assert.deepEqual(calls, [{
    sql: "select public.set_platform_entitlement($1,$2,$3,$4)",
    values: ["agency-b", "fleet", false, "Agency exception"],
  }]);
});

test("Super Admin entitlement reads reject malformed PostgreSQL function results", async () => {
  await assert.rejects(
    listPostgresPlatformEntitlements(async () => ({ rows: [{ value: { departments: [] } }] })),
    /response is invalid/,
  );
});

test("Super Admin API delegates reads and writes to the authorized provider repository", async () => {
  const route = await readFile(new URL("../../app/api/super-admin/route.ts", import.meta.url), "utf8");
  assert.match(route, /resolvePlatformAdminAccess\(\)/);
  assert.match(route, /access\.repository\.listEntitlements\(\)/);
  assert.match(route, /access\.repository\.setEntitlement\(/);
  assert.doesNotMatch(route, /\.from\("(?:departments|feature_catalog|department_features|department_feature_events)"\)/);
});

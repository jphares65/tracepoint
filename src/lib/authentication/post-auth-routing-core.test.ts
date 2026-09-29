import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { shouldRouteToPlatformConsole } from "./post-auth-routing-core";

test("platform administrator without a department lands in the platform console", () => {
  assert.equal(shouldRouteToPlatformConsole({isPlatformAdmin:true,hasActiveDepartmentMembership:false}),true);
});

test("department members and ordinary membership-free users do not bypass department access", () => {
  assert.equal(shouldRouteToPlatformConsole({isPlatformAdmin:true,hasActiveDepartmentMembership:true}),false);
  assert.equal(shouldRouteToPlatformConsole({isPlatformAdmin:false,hasActiveDepartmentMembership:true}),false);
  assert.equal(shouldRouteToPlatformConsole({isPlatformAdmin:false,hasActiveDepartmentMembership:false}),false);
});

test("routing consults subject-bound database grant while department access remains membership-gated", () => {
  const postgres=readFileSync("src/lib/tracepoint/server-access-postgres.ts","utf8");
  const proxy=readFileSync("src/lib/authentication/request-proxy.ts","utf8");
  const platform=readFileSync("src/lib/platform/admin-access.ts","utf8");
  assert.match(postgres,/resolvePostgresPlatformLanding[\s\S]*beginSubject\(client,principal\.userId\)[\s\S]*public\.is_platform_admin\(\)/);
  assert.match(postgres,/if\(!memberships\.rowCount\)[\s\S]*No active department membership was found/);
  assert.match(proxy,/if\(pathname==="\/"\)[\s\S]*shouldRouteToPlatformConsole[\s\S]*"\/platform"/);
  assert.match(platform,/select public\.is_platform_admin\(\) as allowed/);
});

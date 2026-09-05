import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proxySource = readFileSync(
  new URL("../supabase/proxy.ts", import.meta.url),
  "utf8",
);

test("unauthenticated API requests return a no-store JSON 401", () => {
  assert.match(proxySource, /if \(isApiPath\(pathname\)\) \{[\s\S]*return apiAccessFailure\([\s\S]*response,[\s\S]*401,[\s\S]*"Authentication is required\."/);
  assert.match(proxySource, /NextResponse\.json\([\s\S]*headers: \{ "Cache-Control": "no-store" \}/);
});

test("unauthenticated browser navigation retains the login redirect", () => {
  assert.match(proxySource, /requestedPath[\s\S]*redirectWithCookies\([\s\S]*"\/login"/);
});

test("inactive API users receive a no-store JSON 403", () => {
  assert.match(proxySource, /if \(memberships\.length === 0\)[\s\S]*apiAccessFailure\([\s\S]*403,[\s\S]*"No active department membership was found\."/);
});

test("authenticated unauthorized API users use the generic 403 boundary", () => {
  assert.match(proxySource, /function forbiddenOrRedirect[\s\S]*isApiPath\(request\.nextUrl\.pathname\)[\s\S]*apiAccessFailure\([\s\S]*403,[\s\S]*"You do not have permission to perform this request\."/);
  assert.match(proxySource, /if \(!meetsPermissionRequirement\(permissions, requirement\)\) \{\s*return forbiddenOrRedirect\(/);
});

test("the public health endpoint remains available without authentication", () => {
  assert.match(proxySource, /const PUBLIC_PATHS = \[[^\]]*"\/api\/health"/);
  assert.match(proxySource, /if \(!authenticated && !isPublicPath\(pathname\)\)/);
});

test("authenticated permitted requests retain the cookie-aware response", () => {
  assert.match(proxySource, /setAll\(cookiesToSet\)[\s\S]*response\.cookies\.set\(name, value, options\)/);
  assert.match(proxySource, /if \(!meetsPermissionRequirement[\s\S]*\}\s*return response;\s*\}/);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hasReturnPathCookie,
  loginReturnPath,
  readFormReturnPath,
  readReturnPathCookie,
  RETURN_PATH_COOKIE,
  returnPathOrHome,
  returnPathSetCookie,
  safeReturnPath,
} from "./return-path.ts";

const accepted: Array<[string, string]> = [
  ["/", "/"],
  ["/equipment", "/equipment"],
  ["/range-days?day=d-1&tab=scores", "/range-days?day=d-1&tab=scores"],
  ["/firearms/0b0e6a2c-1f7e-4c55-8f0c-7b1b4d0d9a11", "/firearms/0b0e6a2c-1f7e-4c55-8f0c-7b1b4d0d9a11"],
  ["/personnel?q=John%20Smith", "/personnel?q=John%20Smith"],
  ["/fleet-management/v-1?tab=equipment", "/fleet-management/v-1?tab=equipment"],
  ["/equipment?tab=assigned#current", "/equipment?tab=assigned"],
  ["/reports?return=https://elsewhere.invalid", "/reports?return=https://elsewhere.invalid"],
  ["/landing", "/landing"],
  ["/settings/import-export", "/settings/import-export"],
  ["/loginhelp", "/loginhelp"],
  ["/apidocs", "/apidocs"],
  ["/x/../equipment", "/equipment"],
];

const hostile: unknown[] = [
  undefined, null, 0, {}, [], "", " ", "equipment", "./equipment", "../equipment",
  // schemes and protocol-relative
  "https://evil.invalid", "http://evil.invalid/", "HTTPS://evil.invalid", "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>", "mailto:x@evil.invalid", "http:/evil.invalid", "https:evil.invalid",
  "//evil.invalid", "///evil.invalid", "////evil.invalid", "//evil.invalid/%2F..",
  // backslash forms (browsers treat "\" as "/")
  "/\\evil.invalid", "\\\\evil.invalid", "\\/evil.invalid", "/\\/evil.invalid", "/x\\..\\evil",
  // encoded variants
  "/%2Fevil.invalid", "/%2fevil.invalid", "/%2F%2Fevil.invalid", "%2F%2Fevil.invalid", "/%5Cevil.invalid", "/%5cevil.invalid",
  "/%252Fevil.invalid", "/%25252Fevil.invalid", "/%252F%252Fevil.invalid", "/%255Cevil.invalid", "/%2525252F%2525252Fevil",
  "/%09/evil.invalid", "/%0A/evil.invalid", "/%0d%0aSet-Cookie:x=y", "/%00evil", "/%7F", "/%20/evil.invalid", "/%E2%80%A8",
  "/%zz", "/%", "/%E0%A4%A",
  // raw control and whitespace characters
  "/\tevil.invalid", "/\nevil", "/\r\nLocation: https://evil.invalid", " /equipment", "/equipment ", "/\u0000", "/" + String.fromCharCode(0x2028) + "x", "/" + String.fromCharCode(0xa0) + "x",
  // authentication and API routes, however spelled
  "/login", "/LOGIN", "/Login/", "/login?next=/equipment", "/login#x", "/activate", "/activate?token=x",
  "/auth/signout", "/auth/setup?next=/equipment", "/auth/callback", "/auth/confirm", "/AUTH/signout",
  "/api/auth/cognito/login", "/api/auth/cognito/callback?code=a&state=b", "/api/auth/cognito/logout", "/api/auth/cognito/refresh",
  "/api/notifications", "/api/notifications/email-dispatch", "/API/access",
  "/./login", "/x/../login", "/%2e%2e/login", "/x/%2e%2e/login", "/%6Cogin", "/%6c%6f%67%69%6e", "/x/..%2Flogin", "/x/..%252Flogin",
  "/%61pi/auth/cognito/logout", "/x/..%2F..%2Fapi%2Fnotifications",
  // oversized
  "/" + "a".repeat(2048), "/equipment?" + "q=1&".repeat(600),
];

test("return-path validator keeps same-origin relative destinations", () => {
  for (const [input, expected] of accepted) assert.equal(safeReturnPath(input), expected, input);
});

test("return-path validator rejects open-redirect, encoded, control-character and auth-route destinations", () => {
  for (const value of hostile) {
    assert.equal(safeReturnPath(value), null, JSON.stringify(value));
    assert.equal(returnPathOrHome(value), "/", JSON.stringify(value));
  }
});

test("every accepted destination resolves to the application origin when used as a redirect", () => {
  const origin = "https://staging.tracepointhq.com";
  for (const value of [...accepted.map(([input]) => input), ...hostile]) {
    const target = returnPathOrHome(value);
    assert.equal(new URL(target, origin).origin, origin, JSON.stringify(value));
    assert.equal(new URL(origin + target).origin, origin, JSON.stringify(value));
  }
});

test("the idle hand-off cookie round-trips only a validated path and is ignored when duplicated or hostile", () => {
  const set = returnPathSetCookie("/range-days?day=d-1");
  for (const required of [RETURN_PATH_COOKIE + "=", "Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=900"]) assert.ok(set.includes(required), required);
  assert.equal(set.includes("Domain="), false);
  const pair = set.split(";")[0];
  assert.equal(readReturnPathCookie(pair), "/range-days?day=d-1");
  assert.equal(readReturnPathCookie("other=1; " + pair + "; more=2"), "/range-days?day=d-1");
  assert.equal(hasReturnPathCookie(pair), true);
  assert.equal(readReturnPathCookie(pair + "; " + pair), null);
  assert.equal(readReturnPathCookie(null), null);
  for (const value of ["//evil.invalid", "/\\evil.invalid", "https://evil.invalid", "/login", "%2F%2Fevil.invalid", "/%5Cevil"]) {
    assert.equal(readReturnPathCookie(`${RETURN_PATH_COOKIE}=${encodeURIComponent(value)}`), null, value);
    assert.ok(returnPathSetCookie(value).includes("Max-Age=0"), value);
  }
  assert.ok(returnPathSetCookie(null).startsWith(RETURN_PATH_COOKIE + "=;"));
});

test("/login prefers an explicit next and otherwise uses the idle hand-off cookie", () => {
  const cookie = returnPathSetCookie("/qualifications?officer=o-1").split(";")[0];
  assert.equal(loginReturnPath("/equipment", cookie), "/equipment");
  assert.equal(loginReturnPath(undefined, cookie), "/qualifications?officer=o-1");
  assert.equal(loginReturnPath("", cookie), "/qualifications?officer=o-1");
  // A hostile explicit next is not replaced by the cookie: it falls back home.
  assert.equal(loginReturnPath("//evil.invalid", cookie), "/");
  assert.equal(loginReturnPath(undefined, null), "/");
});

test("form return path reads exactly one small URL-encoded next field", async () => {
  const form = (body: string, type = "application/x-www-form-urlencoded") =>
    new Request("https://staging.tracepointhq.com/api/auth/cognito/login", { method: "POST", headers: { "content-type": type }, body });
  assert.equal(await readFormReturnPath(form("next=%2Frange-days%3Fday%3Dd-1")), "/range-days?day=d-1");
  assert.equal(await readFormReturnPath(form("next=%2Frange-days", "application/x-www-form-urlencoded; charset=UTF-8")), "/range-days");
  assert.equal(await readFormReturnPath(form("next=%2F%2Fevil.invalid")), null);
  assert.equal(await readFormReturnPath(form("next=%2Fa&next=%2Fb")), null);
  assert.equal(await readFormReturnPath(form('{"next":"/equipment"}', "application/json")), null);
  assert.equal(await readFormReturnPath(form("next=%2F" + "a".repeat(5000))), null);
  assert.equal(await readFormReturnPath(new Request("https://staging.tracepointhq.com/x", { method: "POST" })), null);
});

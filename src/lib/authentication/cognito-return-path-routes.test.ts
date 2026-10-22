/* eslint-disable @typescript-eslint/no-explicit-any -- require-cache module doubles */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { createCognitoPkce, type AuthorizationTransaction } from "./cognito-pkce.ts";
import { createCognitoTransport, type CognitoTransportPorts } from "./cognito-transport.ts";
import { RETURN_PATH_COOKIE, returnPathSetCookie } from "./return-path.ts";

// SV-32 / A-64 / A-65 / A-47: handler-level tests for the Cognito sign-in
// routes. The route handlers, the transport and the PKCE boundary run
// unchanged; only the runtime composition (which needs AWS configuration and
// PostgreSQL) is replaced with the same transport over an in-memory
// transaction store (route modules load as CommonJS under tsx, so the stub is
// placed in the require cache).
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };

const config = { environment: "staging" as const, account: "559054714699", region: "us-east-1", userPoolId: "us-east-1_Synthetic", clientId: "syntheticclient", siteOrigin: "https://staging.tracepointhq.com", notificationMode: "normal" as const };
const origin = config.siteOrigin;
const userId = "11111111-1111-4111-8111-111111111111";
const sessionHandle = "S".repeat(43);

const transactions = new Map<string, AuthorizationTransaction>();
const calls = { exchange: 0, establish: 0, revoke: 0 };
const pkce = createCognitoPkce(config, {
  async put(key, value) { transactions.set(key, value); },
  async take(key) { const value = transactions.get(key); transactions.delete(key); return value ?? null; },
}, async () => { calls.exchange++; return Response.json({ access_token: "a", id_token: "i", refresh_token: "r", expires_in: 300, token_type: "Bearer" }); });
const ports: CognitoTransportPorts = {
  pkce,
  async establish() { calls.establish++; return { userId, handle: sessionHandle, expiresAt: Math.floor(Date.now() / 1000) + 3600 }; },
  async rotate() { throw Error("not used"); },
  async revoke() { calls.revoke++; },
};
const transport = createCognitoTransport(config, ports, { enabled: true });
stub(require.resolve("server-only"), {});
stub(require.resolve("./cognito-runtime-transport.ts"), {
  createRuntimeCognitoTransport: () => transport,
  isCognitoRuntimeEnabled: () => true,
  cognitoProviderDisabledResponse: () => Response.json({ code: "provider_disabled" }, { status: 503 }),
});

const loginRoute = require("../../app/api/auth/cognito/login/route.ts");
const callbackRoute = require("../../app/api/auth/cognito/callback/route.ts");
const signoutRoute = require("../../app/auth/signout/route.ts");

function loginForm(next?: string, extraHeaders: Record<string, string> = {}) {
  const body = next === undefined ? "" : new URLSearchParams({ next }).toString();
  return new Request(origin + "/api/auth/cognito/login", {
    method: "POST",
    headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded", ...extraHeaders },
    body,
  });
}

async function signIn(next?: string, extraHeaders: Record<string, string> = {}) {
  const begin: Response = await loginRoute.POST(loginForm(next, extraHeaders));
  assert.equal(begin.status, 303);
  const authorize = new URL(begin.headers.get("location")!);
  const flow = begin.headers.getSetCookie().find((value) => value.startsWith("__Host-tracepoint-cognito-flow="))!.split(";")[0];
  const callback: Response = await callbackRoute.GET(new Request(origin + "/api/auth/cognito/callback?" + new URLSearchParams({ state: authorize.searchParams.get("state")!, code: "synthetic-code" }), {
    headers: { cookie: flow, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
  }));
  return { begin, authorize, callback };
}

test("sign-in returns the user to the original path and query after the Cognito round trip", async () => {
  for (const next of ["/range-days?day=d-1&tab=scores", "/firearms/f-1", "/fleet-management/v-1?tab=equipment", "/personnel?q=John%20Smith"]) {
    const { authorize, callback } = await signIn(next);
    // The destination never travels through the identity provider.
    assert.equal(authorize.toString().includes(encodeURIComponent(next)), false);
    assert.equal(authorize.toString().includes("range-days"), false);
    assert.equal(callback.status, 303, next);
    assert.equal(callback.headers.get("location"), origin + next);
    assert.ok(callback.headers.getSetCookie().some((value) => value.startsWith("__Host-tracepoint-cognito-session=" + sessionHandle)));
  }
});

test("the return path is sealed with the PKCE transaction, not taken from the callback", async () => {
  const begin: Response = await loginRoute.POST(loginForm("/qualifications"));
  const state = new URL(begin.headers.get("location")!).searchParams.get("state")!;
  const flow = begin.headers.getSetCookie()[0].split(";")[0];
  const stored = [...transactions.values()].find((value) => value.state === state)!;
  assert.equal(stored.returnTo, "/qualifications");
  const callback: Response = await callbackRoute.GET(new Request(origin + "/api/auth/cognito/callback?" + new URLSearchParams({ state, code: "c", next: "https://evil.invalid", returnTo: "//evil.invalid" }), { headers: { cookie: flow } }));
  assert.equal(callback.headers.get("location"), origin + "/qualifications");
});

test("hostile, missing or auth-route destinations sign in to My Home", async () => {
  for (const next of [undefined, "", "//evil.invalid", "/\\evil.invalid", "https://evil.invalid/x", "/%2F%2Fevil.invalid", "/%5Cevil.invalid", "/%252F%252Fevil", "/login?next=/x", "/api/auth/cognito/logout", "/auth/signout", "javascript:alert(1)", "/\r\nLocation: https://evil.invalid"]) {
    const { callback } = await signIn(next);
    assert.equal(callback.status, 303, String(next));
    assert.equal(callback.headers.get("location"), origin + "/", String(next));
  }
  // A JSON body or duplicated field is never interpreted as a destination.
  const json: Response = await loginRoute.POST(new Request(origin + "/api/auth/cognito/login", { method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify({ next: "/equipment" }) }));
  assert.equal(json.status, 303);
  const duplicated: Response = await loginRoute.POST(new Request(origin + "/api/auth/cognito/login", { method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded" }, body: "next=%2Fa&next=%2Fb" }));
  const state = new URL(duplicated.headers.get("location")!).searchParams.get("state")!;
  assert.equal([...transactions.values()].find((value) => value.state === state)!.returnTo, undefined);
});

test("login start keeps its CSRF guard: a cross-site form post cannot plant a destination", async () => {
  const before = transactions.size;
  const response: Response = await loginRoute.POST(loginForm("/equipment", { origin: "https://evil.invalid", "sec-fetch-site": "cross-site" }));
  assert.equal(response.status, 403);
  assert.equal(transactions.size, before);
});

test("browser sign-in failures redirect to a login notice instead of rendering JSON; API callers keep JSON", async () => {
  // Expired or missing flow cookie (the most common failure: the 600-second
  // flow window passed on the hosted UI, or Back/double tab).
  const navigate = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
  const stale: Response = await callbackRoute.GET(new Request(origin + "/api/auth/cognito/callback?state=" + "A".repeat(43) + "&code=c", { headers: { cookie: "__Host-tracepoint-cognito-flow=" + "B".repeat(43), ...navigate } }));
  assert.equal(stale.status, 303);
  assert.equal(stale.headers.get("location"), origin + "/login?notice=authorization_rejected");
  assert.ok(stale.headers.getSetCookie().some((value) => value.startsWith("__Host-tracepoint-cognito-flow=;") && value.includes("Max-Age=0")));
  const cancelled: Response = await callbackRoute.GET(new Request(origin + "/api/auth/cognito/callback?error=access_denied&state=x", { headers: navigate }));
  assert.equal(cancelled.headers.get("location"), origin + "/login?notice=authorization_rejected");
  assert.equal(cancelled.status, 303);
  const api: Response = await callbackRoute.GET(new Request(origin + "/api/auth/cognito/callback?error=access_denied"));
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { code: "authorization_rejected" });

  const begin = pkce.begin;
  pkce.begin = async () => { throw Error("store down"); };
  try {
    const unavailable: Response = await loginRoute.POST(loginForm("/range-days?day=d-1", navigate));
    assert.equal(unavailable.status, 303);
    const location = new URL(unavailable.headers.get("location")!);
    assert.equal(location.origin + location.pathname, origin + "/login");
    assert.equal(location.searchParams.get("notice"), "authorization_unavailable");
    assert.equal(location.searchParams.get("next"), "/range-days?day=d-1");
    const unavailableApi: Response = await loginRoute.POST(loginForm("/range-days"));
    assert.equal(unavailableApi.status, 503);
  } finally {
    pkce.begin = begin;
  }
});

test("idle sign-out hands the current path to the next sign-in through a host-only cookie", async () => {
  const signOut = (body: string, headers: Record<string, string> = {}) => signoutRoute.POST(new Request(origin + "/auth/signout", {
    method: "POST",
    headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded", cookie: "__Host-tracepoint-cognito-session=" + sessionHandle, ...headers },
    body,
  }));
  const idle: Response = await signOut("next=" + encodeURIComponent("/range-days?day=d-1"));
  assert.equal(idle.status, 303);
  assert.equal(new URL(idle.headers.get("location")!).searchParams.get("logout_uri"), origin + "/login");
  const handOff = idle.headers.getSetCookie().find((value) => value.startsWith(RETURN_PATH_COOKIE + "="));
  assert.equal(handOff, returnPathSetCookie("/range-days?day=d-1"));
  for (const hostile of ["//evil.invalid", "https://evil.invalid", "/login", "/%5Cevil"]) {
    const response: Response = await signOut("next=" + encodeURIComponent(hostile));
    assert.equal(response.headers.getSetCookie().some((value) => value.startsWith(RETURN_PATH_COOKIE + "=") && !value.includes("Max-Age=0")), false, hostile);
  }
  // Explicit sign-out (no next field) never sets a destination.
  const explicit: Response = await signOut("");
  assert.equal(explicit.headers.getSetCookie().some((value) => value.startsWith(RETURN_PATH_COOKIE + "=")), false);
  // A cross-site sign-out post is still rejected before any cookie is written.
  const forged: Response = await signOut("next=%2Fequipment", { origin: "https://evil.invalid", "sec-fetch-site": "cross-site" });
  assert.equal(forged.status, 403);
  assert.equal(forged.headers.getSetCookie().length, 0);

  // The next sign-in consumes and clears the hand-off cookie.
  const pair = handOff!.split(";")[0];
  const { begin, callback } = await signIn("/range-days?day=d-1", { cookie: pair });
  assert.ok(begin.headers.getSetCookie().some((value) => value.startsWith(RETURN_PATH_COOKIE + "=;") && value.includes("Max-Age=0")));
  assert.equal(callback.headers.get("location"), origin + "/range-days?day=d-1");
});

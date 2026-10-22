import assert from "node:assert/strict";import test from "node:test";import {isAwsNativePublicPath,loginRedirectTarget,safeRequestedPath,sessionExpiryRedirectTarget}from"./request-proxy-core.ts";
test("AWS-native proxy exposes only exact reviewed auth and health routes",()=>{for(const p of ["/login","/api/health","/api/auth/cognito/login","/api/auth/cognito/callback","/api/auth/cognito/refresh","/api/auth/cognito/logout","/api/auth/mobile/logout"])assert.equal(isAwsNativePublicPath(p),true);for(const p of ["/","/api/access","/api/auth/cognito/login/extra","/api/auth/mobile/logout/extra","/settings"])assert.equal(isAwsNativePublicPath(p),false);});
test("redirect path stays same-origin relative",()=>{assert.equal(safeRequestedPath("/settings","?tab=x"),"/settings?tab=x");assert.equal(safeRequestedPath("//evil",""),"/");});
test("invalid application sessions on protected routes redirect safely without authenticating",()=>{
 assert.equal(sessionExpiryRedirectTarget("/equipment","?tab=active"),"/login?next=%2Fequipment%3Ftab%3Dactive");
 assert.equal(sessionExpiryRedirectTarget("/login",""),null);
 assert.equal(sessionExpiryRedirectTarget("/",""),"/landing");
});
test("authenticated login redirects only to a safe internal next path",()=>{
 assert.equal(loginRedirectTarget("?next=%2Fequipment%3Ftab%3Dactive"),"/equipment?tab=active");
 assert.equal(loginRedirectTarget("?next=https%3A%2F%2Fevil.invalid"),"/");
 assert.equal(loginRedirectTarget("?next=%2F%2Fevil.invalid"),"/");
});
test("SV-32: an authenticated /login visit and an expired session never build an off-origin redirect",()=>{
 const origin="https://staging.tracepointhq.com";
 for(const next of ["/\\evil.invalid","/%5Cevil.invalid","//evil.invalid","/%2F%2Fevil.invalid","https://evil.invalid","/\t/evil.invalid","/api/auth/cognito/logout","/login?next=/x","/auth/signout"]){
  const target=loginRedirectTarget("?"+new URLSearchParams({next}));
  assert.equal(target,"/",next);
  assert.equal(new URL(target,origin).origin,origin,next);
 }
 assert.equal(loginRedirectTarget("?next="+encodeURIComponent("/range-days?day=d-1")),"/range-days?day=d-1");
 assert.equal(sessionExpiryRedirectTarget("/range-days","?day=d-1&tab=scores"),"/login?next=%2Frange-days%3Fday%3Dd-1%26tab%3Dscores");
 assert.equal(sessionExpiryRedirectTarget("//evil.invalid",""),"/login");
 assert.equal(sessionExpiryRedirectTarget("/auth/setup",""),"/login");
 assert.equal(safeRequestedPath("/\\evil",""),"/");
});
test("A-65: only a top-level document navigation to an API URL is sent to sign in; fetch and native callers keep JSON",async()=>{
 const {isDocumentNavigation,API_NAVIGATION_SIGN_IN_TARGET}=await import("./request-proxy-core.ts");
 assert.equal(isDocumentNavigation(new Headers({"sec-fetch-mode":"navigate","sec-fetch-dest":"document"})),true);
 assert.equal(isDocumentNavigation(new Headers({"sec-fetch-mode":"navigate"})),true);
 for(const headers of [{},{"sec-fetch-mode":"cors","sec-fetch-dest":"empty"},{"sec-fetch-mode":"same-origin"},{"sec-fetch-mode":"navigate","sec-fetch-dest":"iframe"},{accept:"text/html"}])
  assert.equal(isDocumentNavigation(new Headers(headers as Record<string,string>)),false,JSON.stringify(headers));
 assert.equal(API_NAVIGATION_SIGN_IN_TARGET,"/login?notice=session_expired");
});

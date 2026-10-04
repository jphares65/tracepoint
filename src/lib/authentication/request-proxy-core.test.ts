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

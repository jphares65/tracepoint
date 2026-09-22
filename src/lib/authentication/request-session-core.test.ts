import assert from "node:assert/strict";
import test from "node:test";
import { runtimeAuthenticationProvider, uniqueCookieValue } from "./request-session-core.ts";

test("request session accepts only the two reviewed provider tuples",()=>{
 assert.equal(runtimeAuthenticationProvider({TRACEPOINT_RUNTIME_PROVIDER_MODE:"aws-native",TRACEPOINT_AUTH_PROVIDER:"cognito"}),"cognito");
 assert.equal(runtimeAuthenticationProvider({TRACEPOINT_RUNTIME_PROVIDER_MODE:"bridge",TRACEPOINT_AUTH_PROVIDER:"supabase"}),"supabase");
 assert.throws(()=>runtimeAuthenticationProvider({TRACEPOINT_RUNTIME_PROVIDER_MODE:"aws-native",TRACEPOINT_AUTH_PROVIDER:"supabase"}));
});
test("opaque session cookie rejects duplicates and malformed handles",()=>{
 const handle="a".repeat(43),name="__Host-tracepoint-cognito-session";
 assert.equal(uniqueCookieValue(`${name}=${handle}`,name),handle);
 assert.equal(uniqueCookieValue(null,name),null);
 assert.throws(()=>uniqueCookieValue(`${name}=short`,name));
 assert.throws(()=>uniqueCookieValue(`${name}=${handle}; ${name}=${handle}`,name));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Route and server-only modules cannot be imported under node:test, so these
// guard the remediated call paths in source (as proxy-authorization.test.ts does).
const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const writer = source("../ai-importer/server/cognito-personnel-writer.ts");
const settingsData = source("../../app/api/settings/data/route.ts");
const lifecycle = source("./cognito-membership-lifecycle.ts");
const activation = source("../../app/api/settings/users/activation/route.ts");
const assignPassword = source("../../app/api/settings/users/assign-password/route.ts");
const transport = source("./cognito-runtime-transport.ts");

test("NEW-ADM-D: the Cognito personnel writer re-sends the Cognito invitation, never the Supabase activation email", () => {
  assert.doesNotMatch(writer, /issueActivationEmail|@\/lib\/tracepoint\/activation/);
  assert.equal(writer.match(/await resendPendingCognitoActivation\(\{/g)?.length, 2);
});

test("NEW-ADM-E: aws-native Settings activation changes run update_department_member inside the Cognito lifecycle preparation", () => {
  assert.match(settingsData, /body\.rpc === "update_department_member" && typeof args\.p_is_active === "boolean" &&\s*process\.env\.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native" && notificationMode\(process\.env\) === "normal"/);
  assert.match(settingsData, /current\.is_active !== args\.p_is_active/);
  assert.match(settingsData, /await setCognitoMembershipActive\([\s\S]*supportMode: access\.context\.isSupportMode \},\s*async client => \{ await client\.query\(\s*"select public\.update_department_member\(/);
  assert.match(lifecycle, /prepare_cognito_membership_operation[\s\S]*await withinPrepare\?\.\(client\);[\s\S]*return \{ providerUsername/);
});

test("Send Activation reads the identity state outside the request role, after the tenant-scoped membership check", () => {
  assert.doesNotMatch(activation, /from\("authentication_identity_links"\)/);
  assert.match(activation, /if \(!membership\) return[\s\S]*getPostgresPool\(\)\.query\(\s*"select state from public\.authentication_identity_links where tracepoint_user_id=\$1 and provider='cognito'"/);
});

test("NEW-ADM-B: Assign Password reports a Cognito pool policy rejection as a 400 with the policy message", () => {
  assert.match(assignPassword, /\} catch \(error\) \{\s*const rejected = cognitoPasswordRejection\(error\);\s*if \(rejected\) return NextResponse\.json\(\{ error: rejected \}, \{ status: 400 \}\);/);
});

test("NEW-ADM-A: only the initial PKCE callback may activate a pending identity", () => {
  assert.match(transport, /new FirstLoginIdentityMappingStore\(mapping,pool\)/);
  assert.match(transport, /createCognitoSessionEstablisher\(configuration\.verification, initialMapping, initialSessions, refresh\)/);
  assert.match(transport, /createCognitoRefreshRotator\(\s*configuration\.verification,\s*mapping,\s*sessions,/);
});

test("NEW-ADM-F: outside Support Mode for the agency, the Platform page explains how to send activation instead of offering the button", () => {
  const page = source("../../app/platform/[departmentId]/page.tsx");
  const button = source("../../app/platform/[departmentId]/ActivationButton.tsx");
  assert.match(page, /const requiresSupportMode =\s*process\.env\.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native" &&\s*!\(cookieStore\.get\("tracepoint_support_department_id"\)\?\.value === departmentId &&\s*cookieStore\.get\("tracepoint_department_id"\)\?\.value === departmentId\);/);
  assert.match(page, /<ActivationButton[\s\S]*requiresSupportMode=\{requiresSupportMode\}/);
  assert.match(button, /if \(requiresSupportMode\) \{\s*return \([\s\S]*Use Access Agency to enter Support Mode for this agency, then send the activation\.[\s\S]*\);\s*\}[\s\S]*async function sendActivation/);
  // Guidance only: the activation route's authorization is unchanged.
  assert.match(activation, /if \(access\.context\.departmentId !== departmentId\) return NextResponse\.json\(\{ error: "The active agency does not match this request\." \}, \{ status: 403 \}\);/);
});

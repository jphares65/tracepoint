import assert from "node:assert/strict";
import test from "node:test";

import { isApprovedRehearsalInvite } from "./cognito-rehearsal-invite-guard";

const environment = {
  TRACEPOINT_REHEARSAL_APP_MODE: "object-smoke",
  TRACEPOINT_NOTIFICATION_MODE: "shadow",
  TRACEPOINT_RUNTIME_PROVIDER_MODE: "aws-native",
  TRACEPOINT_DATA_PROVIDER: "postgres",
  TRACEPOINT_AUTH_PROVIDER: "cognito",
  TRACEPOINT_STORAGE_PROVIDER: "s3",
  TRACEPOINT_EMAIL_PROVIDER: "ses",
  CONFIGURATION_ENVIRONMENT: "production",
  TRACEPOINT_AWS_ACCOUNT_ID: "193644343389",
  AWS_REGION: "us-east-1",
  TRACEPOINT_COGNITO_USER_POOL_ID: "us-east-1_wZwXHpznS",
  NEXT_PUBLIC_SITE_URL: "https://shadow-rehearsal.tracepointhq.com",
  TRACEPOINT_REHEARSAL_INVITE_EMAIL: "jphares@tracepointhq.com",
};
const input = {
  actorUserId: "c38e1b61-551b-4519-ae3e-6b0f76a1ac01",
  departmentId: "d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0",
  email: "jphares@tracepointhq.com",
  fullName: "TracePoint Rehearsal Invite Test",
  roleCodes: ["officer"],
  groupIds: [],
  badgeNumber: "",
  rankTitle: "",
  unitName: "",
  employeeNumber: "",
  siteUrl: "https://shadow-rehearsal.tracepointhq.com",
};

test("permits only the one bounded rehearsal invitation", () => {
  assert.equal(isApprovedRehearsalInvite(environment, input), true);
  assert.equal(isApprovedRehearsalInvite(environment, undefined), false);
  for (const change of [
    { email: "someone@example.com" },
    { departmentId: "1d0e2994-4224-4237-8328-71020ba20027" },
    { actorUserId: "00000000-0000-4000-8000-000000000001" },
    { roleCodes: ["administrator"] },
    { groupIds: ["00000000-0000-4000-8000-000000000001"] },
    { fullName: "Customer" },
    { badgeNumber: "1" },
    { active: false },
  ]) assert.equal(isApprovedRehearsalInvite(environment, { ...input, ...change }), false);
});

test("never grants the exception to public, Phase 3B shadow, other pools, or other addresses", () => {
  for (const change of [
    { TRACEPOINT_REHEARSAL_APP_MODE: undefined },
    { TRACEPOINT_NOTIFICATION_MODE: "normal" },
    { TRACEPOINT_DATA_PROVIDER: "supabase" },
    { TRACEPOINT_AWS_ACCOUNT_ID: "265544358665" },
    { TRACEPOINT_COGNITO_USER_POOL_ID: "us-east-1_diFmWDMe9" },
    { NEXT_PUBLIC_SITE_URL: "https://shadow.tracepointhq.com" },
    { TRACEPOINT_REHEARSAL_INVITE_EMAIL: "other@example.com" },
    { TRACEPOINT_REHEARSAL_INVITE_EMAIL: undefined },
  ]) assert.equal(isApprovedRehearsalInvite({ ...environment, ...change }, input), false);
});

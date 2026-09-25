type InviteScope = {
  actorUserId: string;
  departmentId: string;
  email: string;
  fullName: string;
  roleCodes: string[];
  groupIds: string[];
  siteUrl: string;
  badgeNumber: string;
  rankTitle: string;
  unitName: string;
  employeeNumber: string;
  active?: boolean;
};

// This exception is deliberately limited to one disposable rehearsal invitation.
// It does not change the normal shadow-mode prohibition on identity mutation.
export function isApprovedRehearsalInvite(
  environment: Record<string, string | undefined>,
  input: InviteScope | undefined,
): boolean {
  if (!input) return false;
  const expectedEmail = environment.TRACEPOINT_REHEARSAL_INVITE_EMAIL?.trim().toLowerCase();
  return environment.TRACEPOINT_REHEARSAL_APP_MODE === "object-smoke" &&
    environment.TRACEPOINT_NOTIFICATION_MODE === "shadow" &&
    environment.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native" &&
    environment.TRACEPOINT_DATA_PROVIDER === "postgres" &&
    environment.TRACEPOINT_AUTH_PROVIDER === "cognito" &&
    environment.TRACEPOINT_STORAGE_PROVIDER === "s3" &&
    environment.TRACEPOINT_EMAIL_PROVIDER === "ses" &&
    environment.CONFIGURATION_ENVIRONMENT === "production" &&
    environment.TRACEPOINT_AWS_ACCOUNT_ID === "193644343389" &&
    environment.AWS_REGION === "us-east-1" &&
    environment.TRACEPOINT_COGNITO_USER_POOL_ID === "us-east-1_wZwXHpznS" &&
    environment.NEXT_PUBLIC_SITE_URL === "https://shadow-rehearsal.tracepointhq.com" &&
    expectedEmail === "jphares@tracepointhq.com" &&
    input.email.trim().toLowerCase() === expectedEmail &&
    input.actorUserId === "c38e1b61-551b-4519-ae3e-6b0f76a1ac01" &&
    input.departmentId === "d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0" &&
    input.fullName === "TracePoint Rehearsal Invite Test" &&
    input.siteUrl === "https://shadow-rehearsal.tracepointhq.com" &&
    input.active !== false &&
    input.roleCodes.length === 1 && input.roleCodes[0] === "officer" &&
    input.groupIds.length === 0 &&
    input.badgeNumber === "" && input.rankTitle === "" &&
    input.unitName === "" && input.employeeNumber === "";
}

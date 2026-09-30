import type { AuthenticatedPrincipal } from "./request-session-core";

export type BaselineApplicationAccess = {
  isPlatformAdmin: boolean;
  hasActiveDepartmentMembership: boolean;
};

// An opaque Cognito session proves identity-link/session validity, not that the
// profile may enter the application. Keep /login available for recovery when
// the latter check fails.
export function shouldRedirectAuthenticatedLogin(
  principal: AuthenticatedPrincipal | null,
  providerMode: "aws-native" | "bridge",
  baselineAccess: BaselineApplicationAccess | null,
) {
  if (!principal) return false;
  if (providerMode !== "aws-native" || principal.provider !== "cognito") return true;
  return baselineAccess?.isPlatformAdmin === true ||
    baselineAccess?.hasActiveDepartmentMembership === true;
}

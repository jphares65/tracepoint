import "server-only";

import { COGNITO_SESSION_COOKIE } from "./cognito-transport";

type HeaderSource = {
  get(name: string): string | null;
};

export type ProductionSessionDiagnostic = {
  timestamp: string;
  requestPath: string;
  method: string;
  requestTraceId: string | null;
  applicationSessionCookie: { name: string; present: boolean };
  supportModeCookies: Array<{ name: string; present: boolean }>;
  supportCookiePresent: boolean;
  selectedDepartmentCookiePresent: boolean;
  issuer: string | null;
  cognitoSubject: string | null;
  profileId: string | null;
  identityLinkValidated: boolean | null;
  isPlatformAdmin: boolean | null;
  sessionAccepted: boolean | null;
  rejectionOrReplacementReason: string | null;
  supportModeConsideredActive: boolean | null;
  finalAuthorizationBranch: string | null;
};

const SUPPORT_DEPARTMENT_COOKIE = "tracepoint_support_department_id";
const SELECTED_DEPARTMENT_COOKIE = "tracepoint_department_id";

function sanitizedIdentifier(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.length <= 8
    ? `${normalized.slice(0, 2)}…`
    : `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

function cookieNames(cookieHeader: string | null) {
  return new Set(
    (cookieHeader ?? "")
      .split(";")
      .map((part) => part.slice(0, part.indexOf("=")).trim())
      .filter(Boolean),
  );
}

export function productionSessionDiagnostic(
  requestHeaders: HeaderSource,
  request?: Request,
): ProductionSessionDiagnostic {
  const names = cookieNames(requestHeaders.get("cookie"));
  const supportCookiePresent = names.has(SUPPORT_DEPARTMENT_COOKIE);
  const selectedDepartmentCookiePresent = names.has(SELECTED_DEPARTMENT_COOKIE);

  return {
    timestamp: new Date().toISOString(),
    requestPath: request ? new URL(request.url).pathname : "/server-access",
    method: request?.method ?? "UNKNOWN",
    requestTraceId: sanitizedIdentifier(
      requestHeaders.get("x-request-id") ?? requestHeaders.get("x-amzn-trace-id"),
    ),
    applicationSessionCookie: {
      name: COGNITO_SESSION_COOKIE,
      present: names.has(COGNITO_SESSION_COOKIE),
    },
    supportModeCookies: [
      { name: SELECTED_DEPARTMENT_COOKIE, present: selectedDepartmentCookiePresent },
      { name: SUPPORT_DEPARTMENT_COOKIE, present: supportCookiePresent },
    ],
    supportCookiePresent,
    selectedDepartmentCookiePresent,
    issuer: null,
    cognitoSubject: null,
    profileId: null,
    identityLinkValidated: null,
    isPlatformAdmin: null,
    sessionAccepted: null,
    rejectionOrReplacementReason: null,
    supportModeConsideredActive: null,
    finalAuthorizationBranch: null,
  };
}

export function withResolvedCognitoPrincipal(
  diagnostic: ProductionSessionDiagnostic,
  principal: { issuer: string; subject: string; userId: string },
) {
  return {
    ...diagnostic,
    issuer: sanitizedIdentifier(principal.issuer),
    cognitoSubject: sanitizedIdentifier(principal.subject),
    profileId: sanitizedIdentifier(principal.userId),
    identityLinkValidated: true,
    sessionAccepted: true,
    rejectionOrReplacementReason: "none",
  } satisfies ProductionSessionDiagnostic;
}

// TEMPORARY production incident diagnostic. It deliberately serializes only the
// allow-listed fields above; no cookie value, handle, token, or header is emitted.
export function emitProductionSessionDiagnostic(
  diagnostic: ProductionSessionDiagnostic,
) {
  console.warn(
    JSON.stringify({
      event: "production-session-support-mode-diagnostic",
      ...diagnostic,
    }),
  );
}

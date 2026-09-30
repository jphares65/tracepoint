import type { ErrorEvent } from "@sentry/core";
import type { SentryEvent } from "./sentry-sanitize";
import { sanitizeSentryEvent } from "./sentry-sanitize";

const clientEnvironment = process.env.NEXT_PUBLIC_TRACEPOINT_ENVIRONMENT;
const serverEnvironment = process.env.CONFIGURATION_ENVIRONMENT;
export const sentryEnabled = clientEnvironment === "production" || serverEnvironment === "production";
export const sentryRelease = `tracepoint@${process.env.NEXT_PUBLIC_DEPLOYMENT_VERSION ?? process.env.DEPLOYMENT_VERSION ?? "unknown"}`;

export function sentryOptions(dsn: string | undefined, service: "tracepoint-web" | "tracepoint-api", runtime: "browser" | "nodejs" | "edge") {
  return {
    dsn,
    enabled: sentryEnabled && Boolean(dsn),
    environment: "production",
    release: sentryRelease,
    sendDefaultPii: false,
    includeServerName: false,
    enableLogs: false,
    sendClientReports: false,
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    initialScope: { tags: { service, runtime, environment: "production", release: sentryRelease } },
    beforeBreadcrumb: () => null,
    beforeSend: (event: ErrorEvent) => sanitizeSentryEvent(event as unknown as SentryEvent) as unknown as ErrorEvent,
  };
}

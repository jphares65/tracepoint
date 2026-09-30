import * as Sentry from "@sentry/nextjs";
import { sentryEnabled, sentryOptions } from "./src/lib/observability/sentry-options";

try {
  if (sentryEnabled) Sentry.init(sentryOptions(process.env.SENTRY_API_DSN, "tracepoint-api", "edge"));
} catch {
  // Observability is strictly non-critical to application startup.
}

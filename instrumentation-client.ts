import * as Sentry from "@sentry/nextjs";
import { sentryEnabled, sentryOptions } from "./src/lib/observability/sentry-options";

try {
  if (sentryEnabled) Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, "tracepoint-web", "browser"));
} catch {
  // Observability is strictly non-critical to application startup.
}

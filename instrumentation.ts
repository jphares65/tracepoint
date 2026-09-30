import * as Sentry from "@sentry/nextjs";

export async function register() {
  try {
    if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
    if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
  } catch {
    // Sentry configuration must never prevent a TracePoint server from starting.
  }
}

export function onRequestError(...args: Parameters<typeof Sentry.captureRequestError>) {
  try { return Sentry.captureRequestError(...args); }
  catch { return undefined; }
}

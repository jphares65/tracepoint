import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Vercel packages its own server output; standalone is for the ECS image.
  // Next.js 16.3 standalone tracing conflicts with Vercel's build adapter.
  output: process.env.VERCEL === "1" ? undefined : "standalone",
  deploymentId: process.env.DEPLOYMENT_VERSION,
};

// The token is supplied only as a BuildKit secret for source-map upload; it is
// never baked into an image or exposed to the production runtime.
const productionSentryBuild =
  process.env.TRACEPOINT_SENTRY_PRODUCTION_BUILD === "true" &&
  Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) &&
  Boolean(process.env.SENTRY_AUTH_TOKEN);

export default productionSentryBuild
  ? withSentryConfig(nextConfig, {
      org: "tracepoint-llc",
      project: "tracepoint-web",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: `tracepoint@${process.env.DEPLOYMENT_VERSION ?? "unknown"}` },
      widenClientFileUpload: true,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      silent: true,
      webpack: { treeshake: { removeTracing: true, removeDebugLogging: true } },
    })
  : nextConfig;

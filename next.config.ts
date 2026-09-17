import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel packages its own server output; standalone is for the ECS image.
  // Next.js 16.3 standalone tracing conflicts with Vercel's build adapter.
  output: process.env.VERCEL === "1" ? undefined : "standalone",
  deploymentId: process.env.DEPLOYMENT_VERSION,
  // These are labels only. They let the client shell identify its deployment
  // context without exposing provider, account, or connection information.
  env: {
    NEXT_PUBLIC_CONFIGURATION_ENVIRONMENT:
      process.env.NEXT_PUBLIC_CONFIGURATION_ENVIRONMENT ??
      process.env.CONFIGURATION_ENVIRONMENT,
    NEXT_PUBLIC_VERCEL_ENV:
      process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV,
  },
};

export default nextConfig;

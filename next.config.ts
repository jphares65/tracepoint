import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel packages its own server output; standalone is for the ECS image.
  // Next.js 16.3 standalone tracing conflicts with Vercel's build adapter.
  output: process.env.VERCEL === "1" ? undefined : "standalone",
  deploymentId: process.env.DEPLOYMENT_VERSION,
};

export default nextConfig;

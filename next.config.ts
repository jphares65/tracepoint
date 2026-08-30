import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16's standalone output contains the minimal production server and
  // traced runtime dependencies needed by the ECS container image.
  output: "standalone",
  deploymentId: process.env.DEPLOYMENT_VERSION,
};

export default nextConfig;

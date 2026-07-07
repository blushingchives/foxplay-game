import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/artifact-store/:path*",
        destination: `${process.env.ARTIFACT_STORE_URL}/:path*`,
      },
      {
        source: "/api/pool-manager/:path*",
        destination: `${process.env.POOL_MANAGER_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;

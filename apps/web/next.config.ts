import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["workspace.abitat.io"],
  transpilePackages: ["@abitat/shared"]
};

export default nextConfig;

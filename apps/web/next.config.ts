import type { NextConfig } from "next";

import { allowedDevOriginsFromEnv } from "./lib/allowed-dev-origins";

const nextConfig: NextConfig = {
  allowedDevOrigins: allowedDevOriginsFromEnv(),
  transpilePackages: ["@abitat/shared"]
};

export default nextConfig;

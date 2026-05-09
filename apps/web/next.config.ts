import type { NextConfig } from "next";

import { allowedDevOriginsFromEnv } from "./lib/allowed-dev-origins";

const nextConfig: NextConfig = {
  allowedDevOrigins: allowedDevOriginsFromEnv(),
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/pg-cloudflare/dist/**/*",
      "./node_modules/pg-cloudflare/esm/**/*",
      "../../node_modules/.pnpm/pg-cloudflare@*/node_modules/pg-cloudflare/dist/**/*",
      "../../node_modules/.pnpm/pg-cloudflare@*/node_modules/pg-cloudflare/esm/**/*"
    ]
  },
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@prisma/adapter-pg", "pg"],
  transpilePackages: ["@abitat_reece/shared"]
};

export default nextConfig;

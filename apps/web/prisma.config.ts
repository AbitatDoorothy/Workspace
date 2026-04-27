import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import { defineConfig } from "prisma/config";

const configDir = dirname(fileURLToPath(import.meta.url));

for (const path of [
  resolve(configDir, "../../.env"),
  resolve(configDir, "../../.env.local"),
  resolve(configDir, ".env"),
  resolve(configDir, ".env.local")
]) {
  config({ path, quiet: true, override: false });
}

const databaseUrl =
  process.env["DATABASE_URL"] ?? "postgresql://reece@localhost:5432/abitat_workspace";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts"
  },
  datasource: {
    url: databaseUrl,
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"]
  }
});

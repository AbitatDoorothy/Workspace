import { cp, readdir } from "node:fs/promises";
import { join } from "node:path";

const packageRoot = process.cwd();
const sourceRoot = join(packageRoot, "node_modules", "pg-cloudflare");
const pnpmStoreRoot = join(packageRoot, ".next", "standalone", "node_modules", ".pnpm");

const entries = await readdir(pnpmStoreRoot);
const pgCloudflareEntry = entries.find((entry) => entry.startsWith("pg-cloudflare@"));

if (!pgCloudflareEntry) {
  throw new Error("Cloudflare standalone build is missing pg-cloudflare");
}

const targetRoot = join(pnpmStoreRoot, pgCloudflareEntry, "node_modules", "pg-cloudflare");

await cp(join(sourceRoot, "dist"), join(targetRoot, "dist"), { recursive: true });
await cp(join(sourceRoot, "esm"), join(targetRoot, "esm"), { recursive: true });

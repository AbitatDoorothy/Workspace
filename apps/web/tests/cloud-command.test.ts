import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("cloud command", () => {
  it("exposes one command that starts the cloud workspace stack", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "../../package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.cloud).toBe("node scripts/cloud.mjs");
    expect(packageJson.scripts["cloud:up"]).toBe(packageJson.scripts.cloud);
    expect(packageJson.scripts["cloud:dev"]).toBe("node scripts/cloud-dev.mjs");
    expect(packageJson.scripts["cloud:host"]).toBe("node scripts/cloud-host.mjs");
  });

  it("configures the web app for hosted Cloudflare deployment", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8")
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    const wranglerConfig = await readFile(resolve(process.cwd(), "wrangler.jsonc"), "utf8");
    const openNextConfig = await readFile(resolve(process.cwd(), "open-next.config.ts"), "utf8");

    expect(packageJson.dependencies["@opennextjs/cloudflare"]).toBeTruthy();
    expect(packageJson.devDependencies.wrangler).toBeTruthy();
    expect(packageJson.scripts["build:cloudflare"]).toBe(
      "next build && node scripts/prepare-cloudflare-standalone.mjs && opennextjs-cloudflare build --skipNextBuild"
    );
    expect(packageJson.scripts["deploy:cloudflare"]).toBe(
      "pnpm build:cloudflare && opennextjs-cloudflare deploy"
    );
    expect(packageJson.scripts["preview:cloudflare"]).toBe(
      "pnpm build:cloudflare && opennextjs-cloudflare preview"
    );
    expect(wranglerConfig).toContain('"main": ".open-next/worker.js"');
    expect(wranglerConfig).toContain('"compatibility_flags": ["nodejs_compat"]');
    expect(wranglerConfig).toContain('"name": "abitat-workspace-edge"');
    expect(wranglerConfig).toContain('"pattern": "workspace.abitat.io/*"');
    expect(wranglerConfig).toContain('"zone_name": "abitat.io"');
    expect(wranglerConfig).toContain('"deleted_classes": ["TunnelSession"]');
    expect(openNextConfig).toContain("defineCloudflareConfig");
  });
});

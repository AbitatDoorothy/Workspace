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
});

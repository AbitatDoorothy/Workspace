import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("cli package", () => {
  it("publishes an abitat executable with Node 22 support", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      bin?: Record<string, string>;
      engines?: Record<string, string>;
      files?: string[];
      private?: boolean;
    };

    expect(pkg.private).toBe(false);
    expect(pkg.bin?.abitat).toBe("dist/index.js");
    expect(pkg.dependencies?.["@abitat/host-daemon"]).toBe("workspace:*");
    expect(pkg.files).toEqual(["dist", "README.md"]);
    expect(pkg.engines?.node).toBe(">=22");
  });

  it("publishes the host daemon package used by the CLI", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../host-daemon/package.json", import.meta.url), "utf8")
    ) as {
      bin?: Record<string, string>;
      exports?: Record<string, unknown>;
      files?: string[];
      name?: string;
      private?: boolean;
    };

    expect(pkg.name).toBe("@abitat/host-daemon");
    expect(pkg.private).toBe(false);
    expect(pkg.bin?.["abitat-host"]).toBe("dist/cli/index.js");
    expect(pkg.exports?.["./cli"]).toBeTruthy();
    expect(pkg.files).toEqual(["dist"]);
  });

  it("publishes shared schemas for public package dependencies", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../../packages/shared/package.json", import.meta.url), "utf8")
    ) as {
      exports?: Record<string, unknown>;
      files?: string[];
      name?: string;
      private?: boolean;
    };

    expect(pkg.name).toBe("@abitat/shared");
    expect(pkg.private).toBe(false);
    expect(pkg.exports?.["."]).toBeTruthy();
    expect(pkg.files).toEqual(["dist"]);
  });
});

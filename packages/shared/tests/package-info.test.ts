import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { packageInfo } from "../src/index";

describe("packageInfo", () => {
  it("identifies the shared Phase 0 package", () => {
    expect(packageInfo).toEqual({
      name: "@abitat_reece/shared",
      phase: "Phase 0"
    });
  });

  it("exposes a Metro-compatible React Native entrypoint", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    );

    expect(packageJson["react-native"]).toBe("./src/index.native.ts");
    expect(packageJson.files).toContain("src");
    expect(existsSync(new URL("../src/index.native.ts", import.meta.url))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { packageInfo } from "../src/index";

describe("packageInfo", () => {
  it("identifies the shared Phase 0 package", () => {
    expect(packageInfo).toEqual({
      name: "@abitat/shared",
      phase: "Phase 0"
    });
  });
});

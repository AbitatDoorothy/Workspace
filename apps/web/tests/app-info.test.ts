import { describe, expect, it } from "vitest";

import { appInfo } from "../lib/app-info";

describe("appInfo", () => {
  it("names the Phase 0 workspace scaffold", () => {
    expect(appInfo).toEqual({
      name: "Abitat Workspace",
      phase: "Phase 0",
      runtime: "web"
    });
  });
});

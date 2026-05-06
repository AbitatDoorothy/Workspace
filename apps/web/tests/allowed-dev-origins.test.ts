import { describe, expect, it } from "vitest";

import { allowedDevOriginsFromEnv } from "../lib/allowed-dev-origins";

describe("allowed dev origins", () => {
  it("includes the configured iPhone public URL host", () => {
    expect(
      allowedDevOriginsFromEnv({
        ABITAT_PUBLIC_URL: "http://192.168.1.44:3000"
      })
    ).toEqual(["workspace.abitat.io", "192.168.1.44", "192.168.1.44:3000"]);
  });
});

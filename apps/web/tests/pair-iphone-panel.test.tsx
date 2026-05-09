import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("PairIphonePanel", () => {
  it("points users to the Mac-local pairing command instead of a hosted form", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/components/pair-iphone-panel.tsx"),
      "utf8"
    );

    expect(source).toContain("abitat iphone");
    expect(source).toContain("Mac-local control server");
    expect(source).not.toContain("/api/mobile/pairing/start");
    expect(source).not.toContain('method="post"');
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("onClick=");
  });
});

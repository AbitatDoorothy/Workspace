import { describe, expect, it } from "vitest";

import { navItems } from "../app/components/nav-items";

describe("workspace navigation", () => {
  it("only exposes dashboard and projects as primary sections", () => {
    expect(navItems.map((item) => item.label)).toEqual(["Dashboard", "Projects"]);
  });
});

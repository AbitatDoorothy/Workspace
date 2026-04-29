import { describe, expect, it } from "vitest";

import { navItems } from "../app/components/nav-items";

describe("workspace navigation", () => {
  it("exposes dashboard, projects, and to-do as primary sections", () => {
    expect(navItems.map((item) => item.label)).toEqual(["Dashboard", "Projects", "To-Do"]);
    expect(navItems.find((item) => item.label === "To-Do")).toMatchObject({
      active: "todo",
      href: "/todo"
    });
  });
});

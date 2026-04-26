import { describe, expect, it } from "vitest";

import { assertWorkspaceMember } from "../server/auth/role-checks";

describe("role checks", () => {
  it("allows the demo workspace member and rejects other users", () => {
    expect(() =>
      assertWorkspaceMember({ workspaceId: "workspace_demo", userId: "user_demo" })
    ).not.toThrow();
    expect(() =>
      assertWorkspaceMember({ workspaceId: "workspace_demo", userId: "user_other" })
    ).toThrow("User cannot access workspace");
  });
});

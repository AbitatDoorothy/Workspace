import { describe, expect, it } from "vitest";

import { resolveRepoPath } from "../src/git/paths";

describe("resolveRepoPath", () => {
  it("places GitHub repos under the configured workspace root", () => {
    expect(resolveRepoPath("/tmp/AbitatWorkspace", "https://github.com/acme/app.git")).toBe(
      "/tmp/AbitatWorkspace/repos/github.com/acme/app.git-working"
    );
  });

  it("rejects traversal outside the workspace root", () => {
    expect(() =>
      resolveRepoPath("/tmp/AbitatWorkspace", "https://github.com/acme/../app.git")
    ).toThrow("Invalid GitHub repo URL");
  });
});

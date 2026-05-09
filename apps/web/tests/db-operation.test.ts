import { describe, expect, it } from "vitest";

import { isDbOperationTimeout } from "../server/db/operation";

describe("database operation helpers", () => {
  it("treats hosted database timeout messages as retryable timeouts", () => {
    expect(isDbOperationTimeout(new Error("Query read timeout"))).toBe(true);
    expect(isDbOperationTimeout(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(
      isDbOperationTimeout(new Error("account_context_find_workspace timed out after 5000ms"))
    ).toBe(true);
    expect(isDbOperationTimeout(new Error("Invalid host token"))).toBe(false);
  });
});

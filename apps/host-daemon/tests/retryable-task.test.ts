import { describe, expect, it } from "vitest";

import { createRetryableTask } from "../src/cli/retryable-task";

describe("createRetryableTask", () => {
  it("retries after a failed run and stops after success", async () => {
    let attempts = 0;
    const task = createRetryableTask(async () => {
      attempts += 1;

      if (attempts === 1) {
        throw new TypeError("fetch failed");
      }
    });

    await expect(task.run()).rejects.toThrow("fetch failed");
    expect(task.completed).toBe(false);

    await expect(task.run()).resolves.toBeUndefined();
    expect(task.completed).toBe(true);

    await expect(task.run()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });
});

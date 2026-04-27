import { describe, expect, it } from "vitest";

import { runHeartbeatWithRecovery } from "../src/cli/heartbeat-loop";

describe("runHeartbeatWithRecovery", () => {
  it("logs startup heartbeat failures without throwing", async () => {
    const messages: string[] = [];

    await expect(
      runHeartbeatWithRecovery(
        async () => {
          throw new TypeError("fetch failed");
        },
        (message) => {
          messages.push(message);
        }
      )
    ).resolves.toBeUndefined();
    expect(messages).toEqual(["heartbeat failed; retrying: fetch failed"]);
  });
});

import { describe, expect, it } from "vitest";

import { createSerialHeartbeatLoop, runHeartbeatWithRecovery } from "../src/cli/heartbeat-loop";

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

  it("waits for a slow heartbeat before scheduling the next one", async () => {
    const scheduled: Array<() => Promise<void>> = [];
    const calls: string[] = [];
    let finishHeartbeat: (() => void) | undefined;
    const loop = createSerialHeartbeatLoop(
      async () => {
        calls.push("start");
        await new Promise<void>((resolve) => {
          finishHeartbeat = resolve;
        });
        calls.push("finish");
      },
      1000,
      {
        setTimer: (callback) => {
          scheduled.push(callback);
          return scheduled.length;
        },
        clearTimer: () => undefined
      }
    );

    loop.start();
    expect(scheduled).toHaveLength(1);
    const firstBeat = scheduled[0]();
    expect(calls).toEqual(["start"]);
    expect(scheduled).toHaveLength(1);

    finishHeartbeat?.();
    await firstBeat;

    expect(calls).toEqual(["start", "finish"]);
    expect(scheduled).toHaveLength(2);
  });
});

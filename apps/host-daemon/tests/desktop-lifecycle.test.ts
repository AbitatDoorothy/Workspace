import { describe, expect, it } from "vitest";

import { staleDesktopHelperProcessIds } from "../src/cli/desktop-lifecycle";

describe("desktop helper lifecycle", () => {
  it("selects only orphaned desktop helpers for the same script path and their children", () => {
    const stalePids = staleDesktopHelperProcessIds(
      [
        {
          command: "/bin/node /repo/apps/host-daemon/dist/cli/index.js desktop",
          pid: 100,
          ppid: 1
        },
        {
          command: "codex app-server --listen stdio://",
          pid: 101,
          ppid: 100
        },
        {
          command: "/bin/node /repo/apps/host-daemon/dist/cli/index.js desktop",
          pid: 200,
          ppid: 42
        },
        {
          command: "/bin/node /repo/apps/host-daemon/dist/cli/index.js iphone",
          pid: 300,
          ppid: 1
        },
        {
          command: "/bin/node /other/apps/host-daemon/dist/cli/index.js desktop",
          pid: 400,
          ppid: 1
        }
      ],
      {
        currentPid: 500,
        helperPath: "/repo/apps/host-daemon/dist/cli/index.js"
      }
    );

    expect(stalePids).toEqual([100, 101]);
  });
});

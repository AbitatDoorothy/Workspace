import { describe, expect, it } from "vitest";

import { createIphoneStartupPlan } from "../src/iphone";
import { runCli } from "../src/index";

describe("local-first abitat iphone", () => {
  it("starts the packaged host daemon in local iPhone control mode", () => {
    expect(
      createIphoneStartupPlan({
        codexServerUrl: "ws://127.0.0.1:47777",
        port: 3901,
        transport: "tailscale"
      })
    ).toEqual([
      {
        name: "local-control-server",
        command: "abitat-host",
        args: [
          "iphone",
          "--port",
          "3901",
          "--transport",
          "tailscale",
          "--codex-server-url",
          "ws://127.0.0.1:47777"
        ]
      }
    ]);
  });

  it("does not require hosted login before starting iPhone pairing", async () => {
    const startedProcesses: unknown[] = [];
    const openedUrls: string[] = [];
    const output: string[] = [];

    await expect(
      runCli(["iphone", "--transport", "local", "--port", "3901"], {
        env: {
          CODEX_APP_SERVER_URL: "ws://127.0.0.1:47777"
        },
        fetchFn: async () => {
          throw new Error("Hosted API should not be called for local iPhone pairing");
        },
        homeDir: "/tmp/abitat-cli-local",
        openUrl: (url) => openedUrls.push(url),
        output: (line) => output.push(line),
        startProcess: (process) => {
          startedProcesses.push(process);
        }
      })
    ).resolves.toBe(0);

    expect(openedUrls).toEqual([]);
    expect(startedProcesses).toEqual([
      expect.objectContaining({
        name: "local-control-server",
        args: expect.arrayContaining(["iphone", "--transport", "local"])
      })
    ]);
    expect(output.join("\n")).toContain("Starting local-first iPhone control");
  });
});

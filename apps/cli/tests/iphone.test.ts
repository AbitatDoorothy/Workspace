import { describe, expect, it } from "vitest";

import { createIphoneStartupPlan } from "../src/iphone";

describe("abitat iphone startup plan", () => {
  it("builds a local-first host daemon startup plan", () => {
    expect(
      createIphoneStartupPlan({
        codexServerUrl: "ws://127.0.0.1:17321",
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
          "ws://127.0.0.1:17321"
        ]
      }
    ]);
  });

  it("passes a user-managed endpoint through to the Mac-local server", () => {
    expect(
      createIphoneStartupPlan({
        codexServerUrl: "ws://127.0.0.1:47777",
        endpoint: "https://demo.trycloudflare.com",
        port: 3901,
        transport: "manual"
      })[0]?.args
    ).toEqual([
      "iphone",
      "--port",
      "3901",
      "--transport",
      "manual",
      "--codex-server-url",
      "ws://127.0.0.1:47777",
      "--endpoint",
      "https://demo.trycloudflare.com"
    ]);
  });
});

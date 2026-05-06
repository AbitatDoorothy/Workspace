import { describe, expect, it } from "vitest";

import {
  applyEnvFile,
  createIphoneLauncherBaseEnv,
  createLauncherEnv,
  createRemoteTunnelEnv,
  parseNextDevLock,
  parseWebSocketEndpoint,
  selectLanAddress,
  shouldStartRemoteTunnel
} from "../../../scripts/iphone-dev-utils.mjs";

describe("iPhone dev launcher", () => {
  it("selects a reachable IPv4 LAN address for the phone", () => {
    const address = selectLanAddress({
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      awdl0: [{ address: "169.254.22.4", family: "IPv4", internal: false }],
      en0: [{ address: "192.168.1.44", family: "IPv4", internal: false }]
    });

    expect(address).toBe("192.168.1.44");
  });

  it("builds the web environment from one command defaults", () => {
    const env = createLauncherEnv({
      baseEnv: {},
      lanAddress: "192.168.1.44"
    });

    expect(env).toMatchObject({
      ABITAT_MACHINE_ID: "machine_demo",
      ABITAT_PUBLIC_URL: "http://192.168.1.44:3000",
      CODEX_APP_SERVER_URL: "ws://127.0.0.1:47777",
      HOSTNAME: "0.0.0.0",
      PORT: "3000"
    });
  });

  it("falls back to the demo host when .env.local has a blank machine id", () => {
    const env = createLauncherEnv({
      baseEnv: {
        ABITAT_MACHINE_ID: ""
      },
      lanAddress: "192.168.1.44"
    });

    expect(env.ABITAT_MACHINE_ID).toBe("machine_demo");
  });

  it("keeps explicit user overrides for public URL and ports", () => {
    const env = createLauncherEnv({
      baseEnv: {
        ABITAT_PUBLIC_URL: "https://example.ngrok.app",
        ABITAT_WEB_HOST: "127.0.0.1",
        CODEX_APP_SERVER_URL: "ws://127.0.0.1:48888",
        PORT: "3333"
      },
      lanAddress: "192.168.1.44"
    });

    expect(env).toMatchObject({
      ABITAT_PUBLIC_URL: "https://example.ngrok.app",
      CODEX_APP_SERVER_URL: "ws://127.0.0.1:48888",
      HOSTNAME: "127.0.0.1",
      PORT: "3333"
    });
  });

  it("loads .env.local values without overriding shell values", () => {
    const env = applyEnvFile(
      [
        "ABITAT_PUBLIC_URL=https://workspace.abitat.io",
        "PORT=3000",
        "CLOUDFLARE_TUNNEL_TOKEN=secret-token"
      ].join("\n"),
      {
        PORT: "3901"
      }
    );

    expect(env).toMatchObject({
      ABITAT_PUBLIC_URL: "https://workspace.abitat.io",
      CLOUDFLARE_TUNNEL_TOKEN: "secret-token",
      PORT: "3901"
    });
  });

  it("keeps the iPhone launcher login password on the documented local default", () => {
    const env = createIphoneLauncherBaseEnv({
      envFile: [
        "ABITAT_PUBLIC_URL=https://workspace.abitat.io",
        "ABITAT_LOGIN_PASSWORD=private-env-password",
        "CLOUDFLARE_TUNNEL_TOKEN=secret-token"
      ].join("\n"),
      shellEnv: {}
    });

    expect(env).toMatchObject({
      ABITAT_LOGIN_PASSWORD: "abitat-local",
      ABITAT_PUBLIC_URL: "https://workspace.abitat.io",
      CLOUDFLARE_TUNNEL_TOKEN: "secret-token"
    });
  });

  it("allows an explicit shell login password override for the iPhone launcher", () => {
    const env = createIphoneLauncherBaseEnv({
      envFile: "ABITAT_LOGIN_PASSWORD=private-env-password",
      shellEnv: {
        ABITAT_LOGIN_PASSWORD: "shell-password"
      }
    });

    expect(env.ABITAT_LOGIN_PASSWORD).toBe("shell-password");
  });

  it("enables the remote phone tunnel when public URL and token config exist", () => {
    expect(
      shouldStartRemoteTunnel({
        ABITAT_PUBLIC_URL: "https://workspace.abitat.io",
        CLOUDFLARE_TUNNEL_TOKEN: "secret-token"
      })
    ).toBe(true);
    expect(
      shouldStartRemoteTunnel({
        ABITAT_IPHONE_TUNNEL: "false",
        ABITAT_PUBLIC_URL: "https://workspace.abitat.io",
        CLOUDFLARE_TUNNEL_TOKEN: "secret-token"
      })
    ).toBe(false);
    expect(shouldStartRemoteTunnel({ ABITAT_PUBLIC_URL: "https://workspace.abitat.io" })).toBe(
      false
    );
  });

  it("points the remote phone tunnel back at the selected local web port", () => {
    const env = createRemoteTunnelEnv({
      baseEnv: {
        ABITAT_PUBLIC_URL: "https://workspace.abitat.io",
        CLOUDFLARE_TUNNEL_TOKEN: "secret-token"
      },
      localOrigin: "http://127.0.0.1:3901"
    });

    expect(env).toMatchObject({
      ABITAT_LOCAL_ORIGIN: "http://127.0.0.1:3901",
      ABITAT_PUBLIC_URL: "https://workspace.abitat.io",
      CLOUDFLARE_TUNNEL_TOKEN: "secret-token"
    });
  });

  it("parses the Codex app-server WebSocket endpoint", () => {
    expect(parseWebSocketEndpoint("ws://127.0.0.1:47777")).toEqual({
      host: "127.0.0.1",
      port: 47777
    });
  });

  it("parses a Next dev lock so the launcher can replace stale localhost servers", () => {
    expect(
      parseNextDevLock(
        JSON.stringify({
          appUrl: "http://localhost:3000",
          hostname: "localhost",
          pid: 31935,
          port: 3000,
          startedAt: 1777975897866
        })
      )
    ).toEqual({
      appUrl: "http://localhost:3000",
      hostname: "localhost",
      pid: 31935,
      port: 3000
    });
    expect(parseNextDevLock("{")).toBeNull();
  });
});

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  resolveLocalControlTransport,
  startLocalhostRunTunnel,
  startQuickTunnel,
  waitForQuickTunnelReady
} from "../src/local-control/transport";

describe("local control transport", () => {
  it("prefers a Tailscale IPv4 endpoint when Tailscale is available", async () => {
    await expect(
      resolveLocalControlTransport({
        execFile: async () => ({
          stderr: "",
          stdout: JSON.stringify({
            Self: {
              DNSName: "reece-mac.tailnet.ts.net.",
              TailscaleIPs: ["100.64.1.2", "fd7a:115c:a1e0::1"]
            }
          })
        }),
        port: 3901,
        requestedTransport: "tailscale"
      })
    ).resolves.toMatchObject({
      bindHost: "0.0.0.0",
      endpoint: "http://100.64.1.2:3901",
      transport: "tailscale"
    });
  });

  it("falls back to a local endpoint with an offline diagnostic when Tailscale is unavailable", async () => {
    await expect(
      resolveLocalControlTransport({
        execFile: async () => {
          throw new Error("tailscale is not installed");
        },
        port: 3901,
        requestedTransport: "auto"
      })
    ).resolves.toMatchObject({
      endpoint: "http://127.0.0.1:3901",
      transport: "local",
      warning: expect.stringContaining("Tailscale")
    });
  });

  it("starts a Cloudflare Quick Tunnel and resolves the generated URL", async () => {
    const child = createFakeTunnelProcess();
    const spawned: Array<{ args: string[]; file: string }> = [];
    const tunnelPromise = startQuickTunnel({
      localUrl: "http://127.0.0.1:3901",
      spawnProcess: (file, args) => {
        spawned.push({ file, args });
        return child;
      },
      timeoutMs: 1000
    });

    child.stderr.write("2026-05-09T09:00:00Z INF | https://demo-abitat.trycloudflare.com |");

    await expect(tunnelPromise).resolves.toMatchObject({
      endpoint: "https://demo-abitat.trycloudflare.com"
    });
    expect(spawned).toEqual([
      {
        file: "cloudflared",
        args: ["tunnel", "--url", "http://127.0.0.1:3901"]
      }
    ]);
  });

  it("explains how to install cloudflared when Quick Tunnel cannot start", async () => {
    await expect(
      startQuickTunnel({
        localUrl: "http://127.0.0.1:3901",
        spawnProcess: () => {
          const child = createFakeTunnelProcess();
          queueMicrotask(() => {
            const error = Object.assign(new Error("spawn cloudflared ENOENT"), {
              code: "ENOENT"
            });
            child.emit("error", error);
          });
          return child;
        },
        timeoutMs: 1000
      })
    ).rejects.toThrow("Install cloudflared on the Mac");
  });

  it("starts a localhost.run tunnel and resolves the generated URL", async () => {
    const child = createFakeTunnelProcess();
    const spawned: Array<{ args: string[]; file: string }> = [];
    const tunnelPromise = startLocalhostRunTunnel({
      localUrl: "http://127.0.0.1:3901",
      spawnProcess: (file, args) => {
        spawned.push({ file, args });
        return child;
      },
      timeoutMs: 1000
    });

    child.stdout.write("demo123.lhr.life tunneled with tls termination, https://demo123.lhr.life");

    await expect(tunnelPromise).resolves.toMatchObject({
      endpoint: "https://demo123.lhr.life"
    });
    expect(spawned).toEqual([
      {
        file: "ssh",
        args: expect.arrayContaining(["-R", "80:127.0.0.1:3901", "nokey@localhost.run"])
      }
    ]);
  });

  it("waits for the Quick Tunnel health endpoint before pairing is shown", async () => {
    const requests: string[] = [];

    await expect(
      waitForQuickTunnelReady("https://demo-abitat.trycloudflare.com", {
        fetch: async (url) => {
          requests.push(String(url));
          return new Response(
            requests.length === 1 ? "<html>Cloudflare Tunnel error</html>" : '{"ok":true}',
            {
              headers: { "content-type": requests.length === 1 ? "text/html" : "application/json" },
              status: requests.length === 1 ? 530 : 200,
              statusText: requests.length === 1 ? "Tunnel error" : "OK"
            }
          );
        },
        intervalMs: 1,
        timeoutMs: 100
      })
    ).resolves.toBeUndefined();

    expect(requests).toEqual([
      "https://demo-abitat.trycloudflare.com/health",
      "https://demo-abitat.trycloudflare.com/health"
    ]);
  });
});

function createFakeTunnelProcess() {
  const process = new EventEmitter() as EventEmitter & {
    kill(signal?: NodeJS.Signals): boolean;
    killed: boolean;
    stderr: PassThrough;
    stdout: PassThrough;
  };
  process.stderr = new PassThrough();
  process.stdout = new PassThrough();
  process.killed = false;
  process.kill = () => {
    process.killed = true;
    process.emit("exit", 0, null);
    return true;
  };
  return process;
}

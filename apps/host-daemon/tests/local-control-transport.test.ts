import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  resolveLocalControlTransport,
  shouldStartEndpointHealthMonitor,
  startEndpointHealthMonitor,
  startLocalhostRunTunnel,
  startPinggyTunnel,
  startQuickTunnel,
  startTemporarySshTunnel,
  waitForQuickTunnelReady
} from "../src/local-control/transport";

describe("local control transport", () => {
  it("does not use the fatal endpoint health monitor for relay transport", () => {
    expect(shouldStartEndpointHealthMonitor("relay")).toBe(false);
    expect(shouldStartEndpointHealthMonitor("manual")).toBe(true);
    expect(shouldStartEndpointHealthMonitor("quick-tunnel")).toBe(true);
    expect(shouldStartEndpointHealthMonitor("tailscale")).toBe(true);
    expect(shouldStartEndpointHealthMonitor("local")).toBe(true);
  });

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

  it("uses a local placeholder until a temporary tunnel URL is resolved", async () => {
    await expect(
      resolveLocalControlTransport({
        port: 3901,
        requestedTransport: "temporary-tunnel"
      })
    ).resolves.toMatchObject({
      bindHost: "127.0.0.1",
      endpoint: "http://127.0.0.1:3901",
      transport: "manual",
      warning: expect.stringContaining("Temporary tunnel endpoint")
    });
  });

  it("uses a local placeholder until the relay connection is established", async () => {
    await expect(
      resolveLocalControlTransport({
        port: 3901,
        relayEndpoint: "https://workspace.abitat.io",
        requestedTransport: "relay"
      })
    ).resolves.toMatchObject({
      bindHost: "127.0.0.1",
      endpoint: "https://workspace.abitat.io",
      relayEndpoint: "https://workspace.abitat.io",
      transport: "relay",
      warning: expect.stringContaining("Relay endpoint")
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

  it("starts a Pinggy tunnel and resolves the generated URL", async () => {
    const child = createFakeTunnelProcess();
    const spawned: Array<{ args: string[]; file: string }> = [];
    const tunnelPromise = startPinggyTunnel({
      localUrl: "http://127.0.0.1:3901",
      spawnProcess: (file, args) => {
        spawned.push({ file, args });
        return child;
      },
      timeoutMs: 1000
    });

    child.stdout.write("https://demo-23-144-4-43.run.pinggy-free.link");

    await expect(tunnelPromise).resolves.toMatchObject({
      endpoint: "https://demo-23-144-4-43.run.pinggy-free.link"
    });
    expect(spawned).toEqual([
      {
        file: "ssh",
        args: expect.arrayContaining(["-p", "443", "-R", "0:127.0.0.1:3901", "a.pinggy.io"])
      }
    ]);
  });

  it("falls back from localhost.run to Pinggy for temporary tunnel startup", async () => {
    const firstChild = createFakeTunnelProcess();
    const secondChild = createFakeTunnelProcess();
    const spawned: Array<{ args: string[]; file: string }> = [];
    const tunnelPromise = startTemporarySshTunnel({
      localUrl: "http://127.0.0.1:3901",
      spawnProcess: (file, args) => {
        spawned.push({ file, args });
        return spawned.length === 1 ? firstChild : secondChild;
      },
      timeoutMs: 1000
    });

    firstChild.emit("exit", 255, null);
    secondChild.stdout.write("https://demo-23-144-4-43.run.pinggy-free.link");

    await expect(tunnelPromise).resolves.toMatchObject({
      endpoint: "https://demo-23-144-4-43.run.pinggy-free.link"
    });
    expect(spawned).toEqual([
      {
        file: "ssh",
        args: expect.arrayContaining(["-R", "80:127.0.0.1:3901", "nokey@localhost.run"])
      },
      {
        file: "ssh",
        args: expect.arrayContaining(["-p", "443", "-R", "0:127.0.0.1:3901", "a.pinggy.io"])
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

  it("reports an endpoint that becomes unhealthy after startup", async () => {
    const failures: Error[] = [];
    const monitor = startEndpointHealthMonitor("https://demo-abitat.example", {
      fetch: async () =>
        new Response("No Tunnel", {
          status: 503,
          statusText: "Service Unavailable"
        }),
      intervalMs: 1,
      maxFailures: 2,
      onUnhealthy: (error) => failures.push(error)
    });

    await waitFor(() => failures.length > 0);
    monitor.stop();

    expect(failures[0]?.message).toContain("Tunnel endpoint is no longer reachable");
  });

  it("can monitor relay health under the relay route namespace", async () => {
    const requests: string[] = [];
    const monitor = startEndpointHealthMonitor("https://workspace.abitat.io", {
      fetch: async (url) => {
        requests.push(String(url));
        return Response.json({ ok: true });
      },
      healthPath: "/relay/health",
      intervalMs: 50,
      maxFailures: 1,
      onUnhealthy: (error) => {
        throw error;
      }
    });

    await waitFor(() => requests.length > 0);
    monitor.stop();

    expect(requests[0]).toBe("https://workspace.abitat.io/relay/health");
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

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition");
}

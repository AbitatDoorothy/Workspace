import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Readable } from "node:stream";

import type { LocalControlTransport } from "./state.js";

type ExecFile = (
  file: string,
  args: string[]
) => Promise<{
  stdout: string;
  stderr: string;
}>;

interface QuickTunnelProcess {
  kill(signal?: NodeJS.Signals | number): boolean;
  killed: boolean;
  off(event: string, listener: (...args: any[]) => void): QuickTunnelProcess;
  once(event: string, listener: (...args: any[]) => void): QuickTunnelProcess;
  stderr: Readable;
  stdout: Readable;
}

type SpawnProcess = (file: string, args: string[]) => QuickTunnelProcess;

export interface LocalControlTransportResolution {
  bindHost: string;
  endpoint: string;
  relayEndpoint?: string;
  transport: LocalControlTransport;
  warning?: string;
}

export interface QuickTunnel {
  close(): Promise<void>;
  endpoint: string;
}

export interface SshTunnel {
  close(): Promise<void>;
  endpoint: string;
}

interface WaitForQuickTunnelReadyInput {
  fetch?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
}

export interface EndpointHealthMonitor {
  stop(): void;
}

interface StartEndpointHealthMonitorInput {
  fetch?: typeof fetch;
  healthPath?: string;
  intervalMs?: number;
  maxFailures?: number;
  onUnhealthy(error: Error): void;
}

interface ResolveLocalControlTransportInput {
  endpoint?: string;
  execFile?: ExecFile;
  port: number;
  relayEndpoint?: string;
  requestedTransport: "auto" | LocalControlTransport | "temporary-tunnel";
}

const execFile = promisify(execFileCallback) as ExecFile;

export async function resolveLocalControlTransport(
  input: ResolveLocalControlTransportInput
): Promise<LocalControlTransportResolution> {
  if (input.endpoint) {
    return {
      bindHost: "0.0.0.0",
      endpoint: trimTrailingSlash(input.endpoint),
      transport:
        input.requestedTransport === "auto" || input.requestedTransport === "temporary-tunnel"
          ? "manual"
          : input.requestedTransport
    };
  }

  if (input.requestedTransport === "tailscale" || input.requestedTransport === "auto") {
    const tailscale = await resolveTailscaleEndpoint(input.port, input.execFile ?? execFile).catch(
      (error: unknown) => ({
        warning: `Tailscale endpoint unavailable: ${errorMessage(error)}`
      })
    );

    if ("endpoint" in tailscale) {
      return tailscale;
    }

    if (input.requestedTransport === "tailscale") {
      return {
        bindHost: "127.0.0.1",
        endpoint: `http://127.0.0.1:${input.port}`,
        transport: "local",
        warning: tailscale.warning
      };
    }

    return {
      bindHost: "127.0.0.1",
      endpoint: `http://127.0.0.1:${input.port}`,
      transport: "local",
      warning: tailscale.warning
    };
  }

  if (input.requestedTransport === "quick-tunnel") {
    return {
      bindHost: "127.0.0.1",
      endpoint: `http://127.0.0.1:${input.port}`,
      transport: "quick-tunnel",
      warning: "Quick Tunnel endpoint will be resolved after the local server starts."
    };
  }

  if (input.requestedTransport === "relay") {
    const relayEndpoint = trimTrailingSlash(input.relayEndpoint ?? "https://workspace.abitat.io");
    return {
      bindHost: "127.0.0.1",
      endpoint: relayEndpoint,
      relayEndpoint,
      transport: "relay",
      warning: "Relay endpoint will route through this Mac after the local server starts."
    };
  }

  if (input.requestedTransport === "temporary-tunnel") {
    return {
      bindHost: "127.0.0.1",
      endpoint: `http://127.0.0.1:${input.port}`,
      transport: "manual",
      warning: "Temporary tunnel endpoint will be resolved after the local server starts."
    };
  }

  return {
    bindHost: "127.0.0.1",
    endpoint: `http://127.0.0.1:${input.port}`,
    transport: "local"
  };
}

export function startQuickTunnel(input: {
  localUrl: string;
  spawnProcess?: SpawnProcess;
  timeoutMs?: number;
}): Promise<QuickTunnel> {
  const spawnProcess =
    input.spawnProcess ??
    ((file: string, args: string[]) =>
      spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] }) as QuickTunnelProcess);
  const child = spawnProcess("cloudflared", ["tunnel", "--url", input.localUrl]);
  const timeoutMs = input.timeoutMs ?? 30_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const timer = setTimeout(() => {
      fail(
        new Error(
          "Timed out waiting for Cloudflare Quick Tunnel URL from cloudflared. Check the cloudflared output and try again."
        )
      );
    }, timeoutMs);
    timer.unref?.();

    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();
      const endpoint = parseQuickTunnelEndpoint(output);
      if (!endpoint) {
        return;
      }

      cleanup();
      settled = true;
      resolve({
        endpoint,
        close: () => closeQuickTunnelProcess(child)
      });
    };
    const onError = (error: unknown) => {
      fail(quickTunnelStartError(error));
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(
        new Error(
          `cloudflared exited before creating a Quick Tunnel URL (code=${code ?? "null"}, signal=${
            signal ?? "null"
          }). Install cloudflared on the Mac with: brew install cloudflared`
        )
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      cleanup();
      settled = true;
      reject(error);
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

export function startLocalhostRunTunnel(input: {
  localUrl: string;
  spawnProcess?: SpawnProcess;
  timeoutMs?: number;
}): Promise<SshTunnel> {
  const origin = new URL(input.localUrl);
  const port = origin.port || (origin.protocol === "https:" ? "443" : "80");
  const remote = `80:${origin.hostname}:${port}`;
  const spawnProcess =
    input.spawnProcess ??
    ((file: string, args: string[]) =>
      spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] }) as QuickTunnelProcess);
  const child = spawnProcess("ssh", [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-R",
    remote,
    "nokey@localhost.run"
  ]);
  const timeoutMs = input.timeoutMs ?? 30_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const timer = setTimeout(() => {
      fail(new Error("Timed out waiting for localhost.run tunnel URL from ssh."));
    }, timeoutMs);
    timer.unref?.();

    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();
      const endpoint = parseLocalhostRunEndpoint(output);
      if (!endpoint) {
        return;
      }

      cleanup();
      settled = true;
      resolve({
        endpoint,
        close: () => closeQuickTunnelProcess(child)
      });
    };
    const onError = (error: unknown) => {
      fail(localhostRunStartError(error));
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(
        new Error(
          `ssh exited before creating a localhost.run tunnel URL (code=${code ?? "null"}, signal=${
            signal ?? "null"
          }).`
        )
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      cleanup();
      settled = true;
      reject(error);
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

export function startPinggyTunnel(input: {
  localUrl: string;
  spawnProcess?: SpawnProcess;
  timeoutMs?: number;
}): Promise<SshTunnel> {
  const origin = new URL(input.localUrl);
  const port = origin.port || (origin.protocol === "https:" ? "443" : "80");
  const remote = `0:${origin.hostname}:${port}`;
  const spawnProcess =
    input.spawnProcess ??
    ((file: string, args: string[]) =>
      spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] }) as QuickTunnelProcess);
  const child = spawnProcess("ssh", [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-p",
    "443",
    "-R",
    remote,
    "a.pinggy.io"
  ]);
  const timeoutMs = input.timeoutMs ?? 30_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const timer = setTimeout(() => {
      fail(new Error("Timed out waiting for Pinggy tunnel URL from ssh."));
    }, timeoutMs);
    timer.unref?.();

    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();
      const endpoint = parsePinggyEndpoint(output);
      if (!endpoint) {
        return;
      }

      cleanup();
      settled = true;
      resolve({
        endpoint,
        close: () => closeQuickTunnelProcess(child)
      });
    };
    const onError = (error: unknown) => {
      fail(pinggyStartError(error));
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(
        new Error(
          `ssh exited before creating a Pinggy tunnel URL (code=${code ?? "null"}, signal=${
            signal ?? "null"
          }).`
        )
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      cleanup();
      settled = true;
      reject(error);
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

export function startTemporarySshTunnel(input: {
  localUrl: string;
  onFallback?(error: unknown): void;
  spawnProcess?: SpawnProcess;
  timeoutMs?: number;
}): Promise<SshTunnel> {
  return startLocalhostRunTunnel(input).catch((error: unknown) => {
    input.onFallback?.(error);
    return startPinggyTunnel(input);
  });
}

export async function waitForQuickTunnelReady(
  endpoint: string,
  input: WaitForQuickTunnelReadyInput = {}
) {
  const runFetch = input.fetch ?? fetch;
  const timeoutMs = input.timeoutMs ?? 20_000;
  const intervalMs = input.intervalMs ?? 750;
  const healthUrl = new URL("/health", trimTrailingSlash(endpoint)).toString();
  const deadline = Date.now() + timeoutMs;
  let lastError = "not checked yet";

  while (Date.now() <= deadline) {
    try {
      const response = await runFetch(healthUrl, { method: "GET" });
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
        if (body?.ok === true) {
          return;
        }
        lastError = "health endpoint did not return ok=true";
      } else {
        lastError = `${response.status} ${response.statusText || "response"}`;
      }
    } catch (error) {
      lastError = errorMessage(error);
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Tunnel endpoint is not reachable at ${healthUrl} (${lastError}). Keep the tunnel running on the Mac and try again.`
  );
}

export function startEndpointHealthMonitor(
  endpoint: string,
  input: StartEndpointHealthMonitorInput
): EndpointHealthMonitor {
  const runFetch = input.fetch ?? fetch;
  const intervalMs = input.intervalMs ?? 15_000;
  const maxFailures = input.maxFailures ?? 2;
  const healthUrl = new URL(input.healthPath ?? "/health", trimTrailingSlash(endpoint)).toString();
  let stopped = false;
  let failures = 0;

  const check = async () => {
    if (stopped) {
      return;
    }

    try {
      const response = await runFetch(healthUrl, { method: "GET" });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText || "response"}`);
      }
      const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
      if (body?.ok !== true) {
        throw new Error("health endpoint did not return ok=true");
      }
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= maxFailures && !stopped) {
        stopped = true;
        input.onUnhealthy(
          new Error(
            `Tunnel endpoint is no longer reachable at ${healthUrl}: ${errorMessage(error)}`
          )
        );
      }
    }
  };

  const timer = setInterval(() => void check(), intervalMs);
  timer.unref?.();
  void check();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

export function shouldStartEndpointHealthMonitor(transport: LocalControlTransport) {
  return transport !== "relay";
}

async function resolveTailscaleEndpoint(
  port: number,
  run: ExecFile
): Promise<LocalControlTransportResolution> {
  const { stdout } = await run("tailscale", ["status", "--json"]);
  const status = JSON.parse(stdout) as {
    Self?: {
      DNSName?: unknown;
      TailscaleIPs?: unknown;
    };
  };
  const ips = Array.isArray(status.Self?.TailscaleIPs) ? status.Self?.TailscaleIPs : [];
  const ipv4 = ips.find((ip): ip is string => typeof ip === "string" && /^\d+\./u.test(ip));

  if (!ipv4) {
    throw new Error("no Tailscale IPv4 address found");
  }

  return {
    bindHost: "0.0.0.0",
    endpoint: `http://${ipv4}:${port}`,
    transport: "tailscale"
  };
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/u, "");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseQuickTunnelEndpoint(output: string) {
  return output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu)?.[0] ?? null;
}

function parseLocalhostRunEndpoint(output: string) {
  return output.match(/https:\/\/[a-z0-9-]+\.lhr\.life/iu)?.[0] ?? null;
}

function parsePinggyEndpoint(output: string) {
  return output.match(/https:\/\/[a-z0-9-]+\.run\.pinggy-free\.link/iu)?.[0] ?? null;
}

function quickTunnelStartError(error: unknown) {
  const message = errorMessage(error);
  const code =
    error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  if (code === "ENOENT" || message.includes("ENOENT")) {
    return new Error(
      "Install cloudflared on the Mac with: brew install cloudflared. The iPhone does not need Cloudflare or Tailscale."
    );
  }

  return new Error(`Unable to start Cloudflare Quick Tunnel: ${message}`);
}

function localhostRunStartError(error: unknown) {
  const message = errorMessage(error);
  const code =
    error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  if (code === "ENOENT" || message.includes("ENOENT")) {
    return new Error("Unable to start localhost.run fallback tunnel because ssh is unavailable.");
  }

  return new Error(`Unable to start localhost.run fallback tunnel: ${message}`);
}

function pinggyStartError(error: unknown) {
  const message = errorMessage(error);
  const code =
    error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  if (code === "ENOENT" || message.includes("ENOENT")) {
    return new Error("Unable to start Pinggy fallback tunnel because ssh is unavailable.");
  }

  return new Error(`Unable to start Pinggy fallback tunnel: ${message}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function closeQuickTunnelProcess(child: QuickTunnelProcess) {
  return new Promise<void>((resolve) => {
    if (child.killed) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 1000);
    timer.unref?.();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

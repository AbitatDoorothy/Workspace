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
  transport: LocalControlTransport;
  warning?: string;
}

export interface QuickTunnel {
  close(): Promise<void>;
  endpoint: string;
}

interface ResolveLocalControlTransportInput {
  endpoint?: string;
  execFile?: ExecFile;
  port: number;
  requestedTransport: "auto" | LocalControlTransport;
}

const execFile = promisify(execFileCallback) as ExecFile;

export async function resolveLocalControlTransport(
  input: ResolveLocalControlTransportInput
): Promise<LocalControlTransportResolution> {
  if (input.endpoint) {
    return {
      bindHost: "0.0.0.0",
      endpoint: trimTrailingSlash(input.endpoint),
      transport: input.requestedTransport === "auto" ? "manual" : input.requestedTransport
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

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { loadCliSession, saveCliSession, sessionConfigPath } from "../src/auth";
import { isCliEntrypoint, parseCommand, resolveStartupProcess, runCli } from "../src/index";

describe("abitat cli", () => {
  it("parses the iphone command", () => {
    expect(parseCommand(["iphone"])).toEqual({ command: "iphone" });
  });

  it("defaults to help for unknown commands", () => {
    expect(parseCommand(["nope"])).toEqual({ command: "help" });
  });

  it("detects scoped npm package entrypoints with URL encoding", () => {
    expect(
      isCliEntrypoint(
        "file:///tmp/user/node_modules/%40abitat_reece/cli/dist/index.js",
        "/tmp/user/node_modules/@abitat_reece/cli/dist/index.js"
      )
    ).toBe(true);
  });

  it("runs the hosted login command and stores the approved session", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "abitat-cli-index-login-"));
    const openedUrls: string[] = [];
    const output: string[] = [];

    const fetchFn = async (url: string) => {
      if (url.endsWith("/api/cli/device-login/start")) {
        return Response.json(
          {
            code: "ABITAT-LOGIN",
            deviceLoginId: "cli_login_1",
            expiresAt: "2026-05-07T12:10:00.000Z",
            verificationPath: "/login?cliCode=ABITAT-LOGIN"
          },
          { status: 201 }
        );
      }

      return Response.json({
        status: "approved",
        userId: "user_1",
        cliToken: "cli_secret"
      });
    };

    await expect(
      runCli(["login"], {
        env: {},
        fetchFn,
        homeDir,
        openUrl: (url) => openedUrls.push(url),
        output: (line) => output.push(line),
        pollIntervalMs: 0
      })
    ).resolves.toBe(0);

    expect(openedUrls).toEqual(["https://workspace.abitat.io/login?cliCode=ABITAT-LOGIN"]);
    await expect(loadCliSession(sessionConfigPath(homeDir))).resolves.toEqual({
      apiUrl: "https://workspace.abitat.io",
      cliToken: "cli_secret",
      userId: "user_1"
    });
    expect(output).toContain("Logged in to https://workspace.abitat.io");
    await rm(homeDir, { force: true, recursive: true });
  });

  it("logs out by deleting the stored CLI session", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "abitat-cli-index-logout-"));
    const configPath = sessionConfigPath(homeDir);

    await saveCliSession(
      {
        apiUrl: "https://workspace.abitat.io",
        cliToken: "cli_secret",
        userId: "user_1"
      },
      configPath
    );

    await expect(
      runCli(["logout"], {
        env: {},
        homeDir,
        output: () => {}
      })
    ).resolves.toBe(0);

    await expect(loadCliSession(configPath)).resolves.toBeNull();
    await rm(homeDir, { force: true, recursive: true });
  });

  it("prepares hosted iphone control from the stored CLI session", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "abitat-cli-index-iphone-"));
    const output: string[] = [];
    const openedUrls: string[] = [];
    const startedProcesses: Array<{
      args: string[];
      command: string;
      env?: Record<string, string>;
      name: string;
    }> = [];

    await saveCliSession(
      {
        apiUrl: "https://workspace.abitat.io",
        cliToken: "cli_secret",
        userId: "user_1"
      },
      sessionConfigPath(homeDir)
    );

    const fetchFn = async () =>
      Response.json({
        machineId: "machine_1",
        workspaceId: "workspace_1",
        hostToken: "host_secret"
      });

    await expect(
      runCli(["iphone"], {
        env: {
          ABITAT_MACHINE_NAME: "Reece MacBook Pro",
          CODEX_APP_SERVER_URL: "ws://127.0.0.1:17321"
        },
        fetchFn,
        homeDir,
        isEndpointListening: async () => false,
        openUrl: (url) => openedUrls.push(url),
        output: (line) => output.push(line),
        platform: "darwin",
        startProcess: (process) => startedProcesses.push(process)
      })
    ).resolves.toBe(0);

    expect(openedUrls).toEqual(["https://workspace.abitat.io"]);
    expect(startedProcesses).toEqual([
      {
        name: "codex-app-server",
        command: "codex",
        args: ["app-server", "--listen", "ws://127.0.0.1:17321", "--analytics-default-enabled"]
      },
      {
        name: "host-daemon",
        command: "abitat-host",
        args: ["start"],
        env: {
          ABITAT_API_URL: "https://workspace.abitat.io",
          ABITAT_HOST_TOKEN: "host_secret",
          ABITAT_MACHINE_ID: "machine_1"
        }
      }
    ]);
    expect(output).toContain("Mac host registered as machine_1");
    expect(output).toContain("Open the iPhone app and pair from https://workspace.abitat.io");
    await rm(homeDir, { force: true, recursive: true });
  });

  it("reuses an already running Codex app server instead of starting a duplicate", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "abitat-cli-index-iphone-reuse-"));
    const output: string[] = [];
    const startedProcesses: Array<{ name: string }> = [];

    await saveCliSession(
      {
        apiUrl: "https://workspace.abitat.io",
        cliToken: "cli_secret",
        userId: "user_1"
      },
      sessionConfigPath(homeDir)
    );

    const fetchFn = async () =>
      Response.json({
        machineId: "machine_1",
        workspaceId: "workspace_1",
        hostToken: "host_secret"
      });

    await expect(
      runCli(["iphone"], {
        env: {
          CODEX_APP_SERVER_URL: "ws://127.0.0.1:47777"
        },
        fetchFn,
        homeDir,
        isEndpointListening: async (url) => url === "ws://127.0.0.1:47777",
        openUrl: () => {},
        output: (line) => output.push(line),
        platform: "darwin",
        startProcess: (process) => startedProcesses.push(process)
      })
    ).resolves.toBe(0);

    expect(startedProcesses.map((process) => process.name)).toEqual(["host-daemon"]);
    expect(output).toContain("Using existing Codex app server at ws://127.0.0.1:47777");
    await rm(homeDir, { force: true, recursive: true });
  });

  it("resolves the packaged host daemon instead of relying on the user's PATH", () => {
    expect(
      resolveStartupProcess(
        {
          name: "host-daemon",
          command: "abitat-host",
          args: ["start"],
          env: {
            ABITAT_API_URL: "https://workspace.abitat.io",
            ABITAT_HOST_TOKEN: "host_secret",
            ABITAT_MACHINE_ID: "machine_1"
          }
        },
        {
          resolvePackageExport: () =>
            "file:///opt/abitat/node_modules/@abitat_reece/host-daemon/dist/cli/index.js",
          nodePath: "/usr/local/bin/node"
        }
      )
    ).toEqual({
      name: "host-daemon",
      command: "/usr/local/bin/node",
      args: ["/opt/abitat/node_modules/@abitat_reece/host-daemon/dist/cli/index.js", "start"],
      env: {
        ABITAT_API_URL: "https://workspace.abitat.io",
        ABITAT_HOST_TOKEN: "host_secret",
        ABITAT_MACHINE_ID: "machine_1"
      }
    });
  });
});

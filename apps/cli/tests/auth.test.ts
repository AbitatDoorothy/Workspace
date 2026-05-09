import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  defaultApiUrl,
  deleteCliSession,
  loadCliSession,
  runLoginCommand,
  saveCliSession,
  sessionConfigPath
} from "../src/auth";

describe("CLI auth storage", () => {
  it("defaults to the Mac-local Abitat API", () => {
    expect(defaultApiUrl({})).toBe("http://127.0.0.1:3901");
    expect(defaultApiUrl({ ABITAT_API_URL: "https://staging.abitat.io" })).toBe(
      "https://staging.abitat.io"
    );
  });

  it("stores CLI sessions under the Abitat application support directory", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "abitat-cli-"));
    const configPath = sessionConfigPath(homeDir);

    await saveCliSession(
      {
        apiUrl: "http://127.0.0.1:3901",
        cliToken: "cli_secret",
        userId: "user_1"
      },
      configPath
    );

    await expect(loadCliSession(configPath)).resolves.toEqual({
      apiUrl: "http://127.0.0.1:3901",
      cliToken: "cli_secret",
      userId: "user_1"
    });

    await deleteCliSession(configPath);
    await expect(loadCliSession(configPath)).resolves.toBeNull();
    await rm(homeDir, { force: true, recursive: true });
  });

  it("runs the local browser login flow and stores the approved CLI session", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "abitat-cli-login-"));
    const configPath = sessionConfigPath(homeDir);
    const openedUrls: string[] = [];
    const requests: Array<{ body: unknown; url: string }> = [];

    const fetchFn = async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });

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
      runLoginCommand({
        apiUrl: "http://127.0.0.1:3901",
        configPath,
        fetchFn,
        openUrl: (url) => openedUrls.push(url),
        pollIntervalMs: 0
      })
    ).resolves.toEqual({
      apiUrl: "http://127.0.0.1:3901",
      cliToken: "cli_secret",
      userId: "user_1"
    });

    expect(openedUrls).toEqual(["http://127.0.0.1:3901/login?cliCode=ABITAT-LOGIN"]);
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:3901/api/cli/device-login/start",
        body: null
      },
      {
        url: "http://127.0.0.1:3901/api/cli/device-login/poll",
        body: { deviceLoginId: "cli_login_1" }
      }
    ]);
    await expect(loadCliSession(configPath)).resolves.toEqual({
      apiUrl: "http://127.0.0.1:3901",
      cliToken: "cli_secret",
      userId: "user_1"
    });
    await rm(homeDir, { force: true, recursive: true });
  });

  it("keeps polling through temporary local endpoint failures", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "abitat-cli-login-retry-"));
    const configPath = sessionConfigPath(homeDir);
    let pollAttempts = 0;

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

      pollAttempts += 1;
      if (pollAttempts === 1) {
        return Response.json({ error: "Tunnel unavailable" }, { status: 503 });
      }
      if (pollAttempts === 2) {
        throw new TypeError("fetch failed");
      }

      return Response.json({
        status: "approved",
        userId: "user_1",
        cliToken: "cli_secret"
      });
    };

    await expect(
      runLoginCommand({
        apiUrl: "http://127.0.0.1:3901",
        configPath,
        fetchFn,
        maxPolls: 4,
        openUrl: () => {},
        pollIntervalMs: 0
      })
    ).resolves.toEqual({
      apiUrl: "http://127.0.0.1:3901",
      cliToken: "cli_secret",
      userId: "user_1"
    });

    expect(pollAttempts).toBe(3);
    await rm(homeDir, { force: true, recursive: true });
  });

  it("retries login start through temporary local API failures before opening the browser", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "abitat-cli-login-start-retry-"));
    const configPath = sessionConfigPath(homeDir);
    const openedUrls: string[] = [];
    let startAttempts = 0;

    const fetchFn = async (url: string) => {
      if (url.endsWith("/api/cli/device-login/start")) {
        startAttempts += 1;
        if (startAttempts === 1) {
          return Response.json({ error: "Database timeout" }, { status: 503 });
        }
        if (startAttempts === 2) {
          throw new TypeError("fetch failed");
        }

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
      runLoginCommand({
        apiUrl: "http://127.0.0.1:3901",
        configPath,
        fetchFn,
        openUrl: (url) => openedUrls.push(url),
        pollIntervalMs: 0,
        startRetryDelayMs: 0
      })
    ).resolves.toEqual({
      apiUrl: "http://127.0.0.1:3901",
      cliToken: "cli_secret",
      userId: "user_1"
    });

    expect(startAttempts).toBe(3);
    expect(openedUrls).toEqual(["http://127.0.0.1:3901/login?cliCode=ABITAT-LOGIN"]);
    await rm(homeDir, { force: true, recursive: true });
  });
});

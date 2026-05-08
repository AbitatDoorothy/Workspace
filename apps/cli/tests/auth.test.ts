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
  it("defaults to the hosted Abitat API", () => {
    expect(defaultApiUrl({})).toBe("https://workspace.abitat.io");
    expect(defaultApiUrl({ ABITAT_API_URL: "https://staging.abitat.io" })).toBe(
      "https://staging.abitat.io"
    );
  });

  it("stores CLI sessions under the Abitat application support directory", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "abitat-cli-"));
    const configPath = sessionConfigPath(homeDir);

    await saveCliSession(
      {
        apiUrl: "https://workspace.abitat.io",
        cliToken: "cli_secret",
        userId: "user_1"
      },
      configPath
    );

    await expect(loadCliSession(configPath)).resolves.toEqual({
      apiUrl: "https://workspace.abitat.io",
      cliToken: "cli_secret",
      userId: "user_1"
    });

    await deleteCliSession(configPath);
    await expect(loadCliSession(configPath)).resolves.toBeNull();
    await rm(homeDir, { force: true, recursive: true });
  });

  it("runs the hosted browser login flow and stores the approved CLI session", async () => {
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
        apiUrl: "https://workspace.abitat.io",
        configPath,
        fetchFn,
        openUrl: (url) => openedUrls.push(url),
        pollIntervalMs: 0
      })
    ).resolves.toEqual({
      apiUrl: "https://workspace.abitat.io",
      cliToken: "cli_secret",
      userId: "user_1"
    });

    expect(openedUrls).toEqual(["https://workspace.abitat.io/login?cliCode=ABITAT-LOGIN"]);
    expect(requests).toEqual([
      {
        url: "https://workspace.abitat.io/api/cli/device-login/start",
        body: null
      },
      {
        url: "https://workspace.abitat.io/api/cli/device-login/poll",
        body: { deviceLoginId: "cli_login_1" }
      }
    ]);
    await expect(loadCliSession(configPath)).resolves.toEqual({
      apiUrl: "https://workspace.abitat.io",
      cliToken: "cli_secret",
      userId: "user_1"
    });
    await rm(homeDir, { force: true, recursive: true });
  });
});

import { describe, expect, it } from "vitest";

import { createIphoneStartupPlan, prepareIphoneCommand, registerHost } from "../src/iphone";

describe("abitat iphone", () => {
  it("builds the hosted iphone startup plan", () => {
    expect(
      createIphoneStartupPlan({
        apiUrl: "https://workspace.abitat.io",
        codexServerUrl: "ws://127.0.0.1:17321",
        hostToken: "host_secret",
        machineId: "machine_1"
      })
    ).toEqual([
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
          ABITAT_MACHINE_ID: "machine_1",
          CODEX_APP_SERVER_URL: "ws://127.0.0.1:17321"
        }
      }
    ]);
  });

  it("registers the current Mac with the hosted API", async () => {
    const requests: Array<{ body: unknown; headers: Record<string, string>; url: string }> = [];
    const fetchFn = async (url: string, init: RequestInit) => {
      requests.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body))
      });

      return Response.json({
        machineId: "machine_1",
        workspaceId: "workspace_1",
        hostToken: "host_secret"
      });
    };

    await expect(
      registerHost({
        apiUrl: "https://workspace.abitat.io",
        cliToken: "cli_secret",
        machineName: "Reece MacBook Pro",
        platform: "darwin",
        fetchFn
      })
    ).resolves.toEqual({
      machineId: "machine_1",
      workspaceId: "workspace_1",
      hostToken: "host_secret"
    });

    expect(requests).toEqual([
      {
        url: "https://workspace.abitat.io/api/hosts/register",
        headers: {
          authorization: "Bearer cli_secret",
          "content-type": "application/json"
        },
        body: {
          machineName: "Reece MacBook Pro",
          platform: "darwin"
        }
      }
    ]);
  });

  it("prepares host credentials and startup processes for a logged-in session", async () => {
    const fetchFn = async () =>
      Response.json({
        machineId: "machine_1",
        workspaceId: "workspace_1",
        hostToken: "host_secret"
      });

    await expect(
      prepareIphoneCommand({
        session: {
          apiUrl: "https://workspace.abitat.io",
          cliToken: "cli_secret",
          userId: "user_1"
        },
        codexServerUrl: "ws://127.0.0.1:17321",
        fetchFn,
        machineName: "Reece MacBook Pro",
        platform: "darwin"
      })
    ).resolves.toMatchObject({
      registration: {
        machineId: "machine_1",
        workspaceId: "workspace_1",
        hostToken: "host_secret"
      },
      startupPlan: [
        { name: "codex-app-server" },
        {
          name: "host-daemon",
          env: {
            ABITAT_API_URL: "https://workspace.abitat.io",
            ABITAT_HOST_TOKEN: "host_secret",
            ABITAT_MACHINE_ID: "machine_1",
            CODEX_APP_SERVER_URL: "ws://127.0.0.1:17321"
          }
        }
      ]
    });
  });
});

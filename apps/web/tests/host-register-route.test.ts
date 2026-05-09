import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestCliAccountContext = vi.hoisted(() =>
  vi.fn(async () => ({
    hostMachineId: "machine_existing",
    userId: "user_1",
    workspaceId: "workspace_1"
  }))
);

const registerHost = vi.hoisted(() =>
  vi.fn(async () => ({
    machineId: "machine_1",
    workspaceId: "workspace_1",
    hostToken: "host_secret"
  }))
);

vi.mock("../server/auth/cli-request-auth", () => ({
  getRequestCliAccountContext
}));

vi.mock("../server/hosts", () => ({
  hostService: {
    registerHost
  }
}));

describe("host registration route", () => {
  beforeEach(() => {
    getRequestCliAccountContext.mockClear();
    registerHost.mockClear();
  });

  it("registers the Mac host to the authenticated CLI account", async () => {
    const { POST } = await import("../app/api/hosts/register/route");

    const response = await POST(
      new Request("https://workspace.abitat.io/api/hosts/register", {
        body: JSON.stringify({
          machineName: "Reece MacBook Pro",
          platform: "darwin",
          userId: "user_attacker",
          workspaceId: "workspace_attacker"
        }),
        headers: {
          authorization: "Bearer cli_secret"
        },
        method: "POST"
      })
    );

    await expect(response.json()).resolves.toEqual({
      machineId: "machine_1",
      workspaceId: "workspace_1",
      hostToken: "host_secret"
    });
    expect(registerHost).toHaveBeenCalledWith({
      userId: "user_1",
      workspaceId: "workspace_1",
      machineName: "Reece MacBook Pro",
      platform: "darwin"
    });
  });

  it("marks hosted host registration database timeouts as transient", async () => {
    registerHost.mockRejectedValueOnce(
      Object.assign(new Error("host_register_find_existing timed out after 5000ms"), {
        name: "DbOperationTimeoutError"
      })
    );
    const { POST } = await import("../app/api/hosts/register/route");

    const response = await POST(
      new Request("https://workspace.abitat.io/api/hosts/register", {
        body: JSON.stringify({
          machineName: "Reece MacBook Pro",
          platform: "darwin"
        }),
        headers: {
          authorization: "Bearer cli_secret"
        },
        method: "POST"
      })
    );

    expect(response.status).toBe(503);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const startLogin = vi.hoisted(() =>
  vi.fn(async () => ({
    code: "ABITAT-LOGIN",
    deviceLoginId: "cli_login_1",
    expiresAt: "2026-05-07T12:10:00.000Z",
    verificationPath: "/login?cliCode=ABITAT-LOGIN"
  }))
);
const pollLogin = vi.hoisted(() =>
  vi.fn(async () => ({
    status: "pending" as const
  }))
);
const completeLogin = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const getRequestSessionUserId = vi.hoisted(() => vi.fn(async () => "user_1"));

vi.mock("../server/auth/cli-device-login-service", () => ({
  cliDeviceLoginService: {
    completeLogin,
    pollLogin,
    startLogin
  }
}));

vi.mock("../server/auth/request-session", () => ({
  getRequestSessionUserId
}));

describe("CLI device login routes", () => {
  beforeEach(() => {
    completeLogin.mockClear();
    getRequestSessionUserId.mockClear();
    pollLogin.mockClear();
    startLogin.mockClear();
  });

  it("starts a hosted CLI login", async () => {
    const { POST } = await import("../app/api/cli/device-login/start/route");

    const response = await POST(
      new Request("https://workspace.abitat.io/api/cli/device-login/start")
    );

    await expect(response.json()).resolves.toMatchObject({
      code: "ABITAT-LOGIN",
      deviceLoginId: "cli_login_1"
    });
    expect(response.status).toBe(201);
    expect(startLogin).toHaveBeenCalledOnce();
  });

  it("polls a hosted CLI login", async () => {
    const { POST } = await import("../app/api/cli/device-login/poll/route");

    const response = await POST(
      new Request("https://workspace.abitat.io/api/cli/device-login/poll", {
        body: JSON.stringify({ deviceLoginId: "cli_login_1" }),
        method: "POST"
      })
    );

    await expect(response.json()).resolves.toEqual({ status: "pending" });
    expect(pollLogin).toHaveBeenCalledWith("cli_login_1");
  });

  it("completes a hosted CLI login for the current browser session user", async () => {
    const { POST } = await import("../app/api/cli/device-login/complete/route");

    const response = await POST(
      new Request("https://workspace.abitat.io/api/cli/device-login/complete", {
        body: JSON.stringify({ code: "ABITAT-LOGIN" }),
        method: "POST"
      })
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(completeLogin).toHaveBeenCalledWith({ code: "ABITAT-LOGIN", userId: "user_1" });
  });
});

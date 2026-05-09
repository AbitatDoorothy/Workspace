import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const completeLogin = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const login = vi.hoisted(() =>
  vi.fn(async () => ({
    id: "user_1",
    email: "reece@example.com",
    displayName: "Reece",
    passwordHash: "hash",
    passwordUpdatedAt: new Date("2026-05-08T00:00:00.000Z")
  }))
);
const register = vi.hoisted(() =>
  vi.fn(async () => ({
    user: {
      id: "user_1",
      email: "reece@example.com",
      displayName: "Reece",
      passwordHash: "hash",
      passwordUpdatedAt: new Date("2026-05-08T00:00:00.000Z")
    },
    workspace: {
      id: "workspace_1",
      name: "Reece Workspace",
      ownerUserId: "user_1"
    }
  }))
);
const findDefaultWorkspace = vi.hoisted(() =>
  vi.fn(async () => ({
    id: "workspace_1",
    name: "Reece Workspace",
    ownerUserId: "user_1"
  }))
);

vi.mock("../server/auth/accounts", () => ({
  accountService: {
    findDefaultWorkspace,
    login,
    register
  }
}));

vi.mock("../server/auth/cli-device-login-service", () => ({
  cliDeviceLoginService: {
    completeLogin
  }
}));

describe("CLI device browser flow", () => {
  beforeEach(() => {
    completeLogin.mockClear();
    findDefaultWorkspace.mockClear();
    login.mockClear();
    register.mockClear();
  });

  it("keeps the CLI login code when moving between login and registration", async () => {
    const loginSource = readFileSync(resolve(process.cwd(), "app/login/page.tsx"), "utf8");
    const registerSource = readFileSync(resolve(process.cwd(), "app/register/page.tsx"), "utf8");

    expect(loginSource).toContain("params.cliCode");
    expect(loginSource).toContain('name="cliCode"');
    expect(loginSource).toContain("registerHref");
    expect(registerSource).toContain("params.cliCode");
    expect(registerSource).toContain('name="cliCode"');
    expect(registerSource).toContain("loginHref");
  });

  it("approves the CLI login after a successful browser login", async () => {
    const { POST } = await import("../app/api/login/route");
    const form = new FormData();
    form.set("email", "reece@example.com");
    form.set("password", "correct horse battery staple");
    form.set("cliCode", "ABITAT-LOGIN");

    const response = await POST(
      new Request("https://workspace.abitat.io/api/login", {
        body: form,
        method: "POST"
      })
    );

    expect(response.status).toBe(303);
    expect(completeLogin).toHaveBeenCalledWith({
      code: "ABITAT-LOGIN",
      userId: "user_1",
      workspaceId: "workspace_1"
    });
  });

  it("approves the CLI login after successful browser registration", async () => {
    const { POST } = await import("../app/api/register/route");
    const form = new FormData();
    form.set("email", "reece@example.com");
    form.set("displayName", "Reece");
    form.set("password", "correct horse battery staple");
    form.set("cliCode", "ABITAT-LOGIN");

    const response = await POST(
      new Request("https://workspace.abitat.io/api/register", {
        body: form,
        method: "POST"
      })
    );

    expect(response.status).toBe(303);
    expect(completeLogin).toHaveBeenCalledWith({
      code: "ABITAT-LOGIN",
      userId: "user_1",
      workspaceId: "workspace_1"
    });
  });
});

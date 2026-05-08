import { describe, expect, it } from "vitest";

import { createCliDeviceLoginService } from "../server/auth/cli-device-login-service";

interface TestCliDeviceLogin {
  id: string;
  codeHash: string;
  userId?: string | null;
  cliTokenHash?: string | null;
  expiresAt: Date;
  consumedAt?: Date | null;
  createdAt: Date;
}

function createCliLoginDb() {
  const logins = new Map<string, TestCliDeviceLogin>();

  return {
    cliDeviceLogin: {
      create: async ({ data }: { data: TestCliDeviceLogin }) => {
        logins.set(data.id, data);
        return data;
      },
      findFirst: async ({ where }: { where: Partial<TestCliDeviceLogin> }) =>
        [...logins.values()].find((login) =>
          Object.entries(where).every(
            ([key, value]) => login[key as keyof TestCliDeviceLogin] === value
          )
        ) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => logins.get(where.id) ?? null,
      update: async ({
        data,
        where
      }: {
        data: Partial<TestCliDeviceLogin>;
        where: { id: string };
      }) => {
        const current = logins.get(where.id);
        if (!current) {
          throw new Error(`Missing login ${where.id}`);
        }
        const next = { ...current, ...data };
        logins.set(where.id, next);
        return next;
      }
    },
    state: { logins }
  };
}

describe("CLI device login service", () => {
  it("issues a short lived CLI login code and exchanges it after browser approval", async () => {
    const service = createCliDeviceLoginService(createCliLoginDb(), {
      codeGenerator: () => "ABITAT-LOGIN",
      idGenerator: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-07T12:00:00.000Z"),
      tokenGenerator: () => "cli_token_secret"
    });

    const login = await service.startLogin();
    expect(login).toMatchObject({
      code: "ABITAT-LOGIN",
      deviceLoginId: "cli_login_1"
    });

    await service.completeLogin({ code: "ABITAT-LOGIN", userId: "user_1" });

    await expect(service.pollLogin(login.deviceLoginId)).resolves.toEqual({
      status: "approved",
      userId: "user_1",
      cliToken: "cli_token_secret"
    });
    await expect(service.verifyCliToken("cli_token_secret")).resolves.toEqual({ userId: "user_1" });
    await expect(service.verifyCliToken("wrong_token")).resolves.toBeNull();
  });

  it("keeps polling pending before browser approval", async () => {
    const service = createCliDeviceLoginService(createCliLoginDb(), {
      codeGenerator: () => "ABITAT-LOGIN",
      idGenerator: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-07T12:00:00.000Z")
    });

    const login = await service.startLogin();

    await expect(service.pollLogin(login.deviceLoginId)).resolves.toEqual({ status: "pending" });
  });
});

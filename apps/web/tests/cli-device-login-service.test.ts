import { describe, expect, it } from "vitest";

import {
  createCliDeviceLoginService,
  hashCliDeviceLoginSecret
} from "../server/auth/cli-device-login-service";

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
      idGenerator: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-07T12:00:00.000Z"),
      tokenSecret: "test-secret"
    });

    const login = await service.startLogin();
    expect(login).toMatchObject({
      code: expect.stringMatching(/^cli_code_v2_/u),
      deviceLoginId: expect.stringMatching(/^cli_login_v2_/u)
    });

    await service.completeLogin({ code: login.code, userId: "user_1" });

    const approved = await service.pollLogin(login.deviceLoginId);
    expect(approved).toMatchObject({
      status: "approved",
      userId: "user_1",
      cliToken: expect.stringMatching(/^cli_v2_/u)
    });
    if (approved.status !== "approved") {
      throw new Error("Expected approved login");
    }
    await expect(service.verifyCliToken(approved.cliToken)).resolves.toEqual({ userId: "user_1" });
    await expect(service.verifyCliToken("wrong_token")).resolves.toBeNull();
  });

  it("keeps polling pending before browser approval", async () => {
    const service = createCliDeviceLoginService(createCliLoginDb(), {
      idGenerator: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-07T12:00:00.000Z"),
      tokenSecret: "test-secret"
    });

    const login = await service.startLogin();

    await expect(service.pollLogin(login.deviceLoginId)).resolves.toEqual({ status: "pending" });
  });

  it("starts a hosted CLI login without a database write", async () => {
    const db = createCliLoginDb();
    const create = db.cliDeviceLogin.create;
    let createAttempts = 0;
    db.cliDeviceLogin.create = async (args) => {
      createAttempts += 1;
      return create(args);
    };
    const service = createCliDeviceLoginService(db, {
      idGenerator: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-07T12:00:00.000Z"),
      tokenSecret: "test-secret"
    });

    await service.startLogin();

    expect(createAttempts).toBe(0);
  });

  it("verifies newly issued signed CLI tokens without a database lookup", async () => {
    const db = createCliLoginDb();
    const service = createCliDeviceLoginService(db, {
      idGenerator: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-07T12:00:00.000Z"),
      tokenSecret: "test-secret"
    });

    const login = await service.startLogin();
    await service.completeLogin({ code: login.code, userId: "user_1" });
    const approved = await service.pollLogin(login.deviceLoginId);
    if (approved.status !== "approved") {
      throw new Error("Expected approved login");
    }

    db.cliDeviceLogin.findFirst = async () => {
      throw new Error("Signed CLI tokens should not query the database");
    };

    expect(approved.cliToken).toMatch(/^cli_v2_/u);
    await expect(service.verifyCliToken(approved.cliToken)).resolves.toEqual({ userId: "user_1" });
  });

  it("carries the browser-approved workspace in new signed CLI tokens", async () => {
    const service = createCliDeviceLoginService(createCliLoginDb(), {
      idGenerator: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-07T12:00:00.000Z"),
      tokenSecret: "test-secret"
    });

    const login = await service.startLogin();
    await service.completeLogin({
      code: login.code,
      userId: "user_1",
      workspaceId: "workspace_1"
    });
    const approved = await service.pollLogin(login.deviceLoginId);
    if (approved.status !== "approved") {
      throw new Error("Expected approved login");
    }

    await expect(service.verifyCliToken(approved.cliToken)).resolves.toEqual({
      userId: "user_1",
      workspaceId: "workspace_1"
    });
  });

  it("returns cached login approval when the hosted database poll read stalls", async () => {
    const db = createCliLoginDb();
    const service = createCliDeviceLoginService(db, {
      dbOperationRetries: 1,
      dbOperationTimeoutMs: 1,
      idGenerator: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-07T12:00:00.000Z"),
      tokenSecret: "test-secret"
    });

    const login = await service.startLogin();
    await service.completeLogin({ code: login.code, userId: "user_1" });
    db.cliDeviceLogin.findUnique = async () =>
      new Promise<TestCliDeviceLogin | null>(() => undefined);

    await expect(service.pollLogin(login.deviceLoginId)).resolves.toMatchObject({
      status: "approved",
      userId: "user_1",
      cliToken: expect.stringMatching(/^cli_v2_/u)
    });
  });

  it("retries CLI token verification when a hosted database read stalls", async () => {
    const db = createCliLoginDb();
    db.state.logins.set("cli_login_legacy", {
      id: "cli_login_legacy",
      codeHash: hashCliDeviceLoginSecret("ABITAT-LEGACY"),
      userId: "user_1",
      cliTokenHash: hashCliDeviceLoginSecret("cli_token_secret"),
      expiresAt: new Date("2026-05-07T12:10:00.000Z"),
      consumedAt: new Date("2026-05-07T12:01:00.000Z"),
      createdAt: new Date("2026-05-07T12:00:00.000Z")
    });
    const findFirst = db.cliDeviceLogin.findFirst;
    let attempts = 0;
    const service = createCliDeviceLoginService(db, {
      dbOperationRetries: 1,
      dbOperationTimeoutMs: 1,
      idGenerator: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-07T12:00:00.000Z"),
      tokenSecret: "test-secret"
    });

    db.cliDeviceLogin.findFirst = async (args) => {
      attempts += 1;
      if (attempts === 1) {
        return new Promise<TestCliDeviceLogin | null>(() => undefined);
      }
      return findFirst(args);
    };

    await expect(service.verifyCliToken("cli_token_secret")).resolves.toEqual({ userId: "user_1" });
    expect(attempts).toBe(2);
  });

  it("retries browser approval lookup when a hosted database read stalls", async () => {
    const db = createCliLoginDb();
    db.state.logins.set("cli_login_legacy", {
      id: "cli_login_legacy",
      codeHash: hashCliDeviceLoginSecret("ABITAT-LEGACY"),
      userId: null,
      cliTokenHash: null,
      expiresAt: new Date("2026-05-07T12:10:00.000Z"),
      consumedAt: null,
      createdAt: new Date("2026-05-07T12:00:00.000Z")
    });
    const findFirst = db.cliDeviceLogin.findFirst;
    let attempts = 0;
    const service = createCliDeviceLoginService(db, {
      dbOperationRetries: 1,
      dbOperationTimeoutMs: 1,
      idGenerator: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-07T12:00:00.000Z"),
      tokenSecret: "test-secret"
    });

    db.cliDeviceLogin.findFirst = async (args) => {
      attempts += 1;
      if (attempts === 1) {
        return new Promise<TestCliDeviceLogin | null>(() => undefined);
      }
      return findFirst(args);
    };

    await expect(
      service.completeLogin({ code: "ABITAT-LEGACY", userId: "user_1" })
    ).resolves.toEqual({
      ok: true
    });
    expect(attempts).toBe(2);
  });

  it("retries CLI poll lookup when a hosted database read stalls", async () => {
    const db = createCliLoginDb();
    const findUnique = db.cliDeviceLogin.findUnique;
    let attempts = 0;
    const service = createCliDeviceLoginService(db, {
      dbOperationRetries: 1,
      dbOperationTimeoutMs: 1,
      idGenerator: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-07T12:00:00.000Z"),
      tokenSecret: "test-secret"
    });

    const login = await service.startLogin();
    db.cliDeviceLogin.findUnique = async (args) => {
      attempts += 1;
      if (attempts === 1) {
        return new Promise<TestCliDeviceLogin | null>(() => undefined);
      }
      return findUnique(args);
    };

    await expect(service.pollLogin(login.deviceLoginId)).resolves.toEqual({ status: "pending" });
    expect(attempts).toBe(2);
  });
});

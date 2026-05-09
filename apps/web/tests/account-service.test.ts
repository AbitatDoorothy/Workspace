import { describe, expect, it } from "vitest";

import { createAccountService } from "../server/auth/accounts";

interface TestUser {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  passwordUpdatedAt: Date;
}

interface TestWorkspace {
  id: string;
  name: string;
  ownerUserId: string;
}

interface TestWorkspaceMember {
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "member" | "viewer";
}

function createAccountDb() {
  const users = new Map<string, TestUser>();
  const workspaces = new Map<string, TestWorkspace>();
  const members = new Map<string, TestWorkspaceMember>();

  return {
    user: {
      create: async ({ data }: { data: TestUser }) => {
        users.set(data.id, data);
        return data;
      },
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
        [...users.values()].find((user) => user.id === where.id || user.email === where.email) ??
        null
    },
    workspace: {
      create: async ({ data }: { data: TestWorkspace }) => {
        workspaces.set(data.id, data);
        return data;
      },
      findFirst: async ({ where }: { where: { ownerUserId: string } }) =>
        [...workspaces.values()].find((workspace) => workspace.ownerUserId === where.ownerUserId) ??
        null
    },
    workspaceMember: {
      create: async ({ data }: { data: TestWorkspaceMember }) => {
        members.set(`${data.workspaceId}:${data.userId}`, data);
        return data;
      }
    },
    state: { members, users, workspaces }
  };
}

describe("account service", () => {
  it("registers a user with a default workspace and owner membership", async () => {
    const db = createAccountDb();
    const service = createAccountService(db, { idGenerator: (prefix) => `${prefix}_1` });

    const result = await service.register({
      email: "Reece@Example.COM ",
      password: "correct horse battery staple",
      displayName: "Reece"
    });

    expect(result.user).toMatchObject({
      id: "user_1",
      email: "reece@example.com",
      displayName: "Reece"
    });
    expect(result.workspace).toMatchObject({
      id: "workspace_1",
      ownerUserId: "user_1"
    });
    expect(db.state.members.get("workspace_1:user_1")).toEqual({
      workspaceId: "workspace_1",
      userId: "user_1",
      role: "owner"
    });
    expect(result.user.passwordHash).not.toContain("correct horse");
  });

  it("authenticates registered users and rejects wrong passwords", async () => {
    const db = createAccountDb();
    const service = createAccountService(db, { idGenerator: (prefix) => `${prefix}_1` });

    await service.register({
      email: "reece@example.com",
      password: "correct horse battery staple",
      displayName: ""
    });

    await expect(
      service.login({ email: "reece@example.com", password: "wrong password" })
    ).resolves.toBeNull();
    await expect(
      service.login({ email: "REECE@example.com", password: "correct horse battery staple" })
    ).resolves.toMatchObject({
      email: "reece@example.com",
      id: "user_1"
    });
  });

  it("retries account lookup when a hosted database call stalls", async () => {
    const db = createAccountDb();
    const service = createAccountService(db, { idGenerator: (prefix) => `${prefix}_1` });

    await service.register({
      email: "reece@example.com",
      password: "correct horse battery staple",
      displayName: ""
    });

    const findUnique = db.user.findUnique;
    let attempts = 0;
    db.user.findUnique = async (args) => {
      attempts += 1;
      if (attempts === 1) {
        return new Promise<TestUser | null>(() => undefined);
      }
      return findUnique(args);
    };

    const retryingService = createAccountService(db, {
      dbOperationRetries: 1,
      dbOperationTimeoutMs: 1,
      idGenerator: (prefix) => `${prefix}_1`
    });

    await expect(
      retryingService.login({
        email: "REECE@example.com",
        password: "correct horse battery staple"
      })
    ).resolves.toMatchObject({
      email: "reece@example.com",
      id: "user_1"
    });
    expect(attempts).toBe(2);
  });

  it("rejects duplicate email registration", async () => {
    const db = createAccountDb();
    const service = createAccountService(db, { idGenerator: (prefix) => `${prefix}_1` });

    await service.register({
      email: "reece@example.com",
      password: "correct horse battery staple",
      displayName: "Reece"
    });

    await expect(
      service.register({
        email: "REECE@example.com",
        password: "another correct horse",
        displayName: "Other"
      })
    ).rejects.toThrow("Account already exists");
  });
});

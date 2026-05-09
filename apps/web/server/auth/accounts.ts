import type { Prisma, PrismaClient } from "@prisma/client";

import { randomId } from "../crypto";
import { prisma } from "../db/client";
import {
  DEFAULT_DB_OPERATION_RETRIES,
  DEFAULT_DB_OPERATION_TIMEOUT_MS,
  retryDbOperation,
  runDbOperation
} from "../db/operation";
import { hashPassword, verifyPassword } from "./passwords";

interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  passwordUpdatedAt: Date;
}

interface WorkspaceRecord {
  id: string;
  name: string;
  ownerUserId: string;
}

interface WorkspaceMemberRecord {
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "member" | "viewer";
}

interface AccountDb {
  user: {
    create(args: { data: UserRecord }): Promise<UserRecord>;
    findUnique(args: { where: { email?: string; id?: string } }): Promise<UserRecord | null>;
  };
  workspace: {
    create(args: { data: WorkspaceRecord }): Promise<WorkspaceRecord>;
    findFirst(args: { where: { ownerUserId: string } }): Promise<WorkspaceRecord | null>;
  };
  workspaceMember: {
    create(args: { data: WorkspaceMemberRecord }): Promise<WorkspaceMemberRecord>;
  };
}

interface AccountServiceOptions {
  dbOperationRetries?: number;
  dbOperationTimeoutMs?: number;
  idGenerator?: (prefix: string) => string;
  now?: () => Date;
}

interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
}

interface LoginInput {
  email: string;
  password: string;
}

export function createAccountService(db: AccountDb, options: AccountServiceOptions = {}) {
  const idGenerator = options.idGenerator ?? ((prefix: string) => randomId(prefix));
  const now = options.now ?? (() => new Date());
  const dbOperationRetries = options.dbOperationRetries ?? DEFAULT_DB_OPERATION_RETRIES;
  const dbOperationTimeoutMs = options.dbOperationTimeoutMs ?? DEFAULT_DB_OPERATION_TIMEOUT_MS;

  return {
    async register(input: RegisterInput) {
      const email = normalizeEmail(input.email);
      const displayName = normalizeDisplayName(input.displayName, email);
      validateEmail(email);
      validatePassword(input.password);

      const existingUser = await retryDbOperation(
        "account_register_find_user",
        () => db.user.findUnique({ where: { email } }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );
      if (existingUser) {
        throw new Error("Account already exists");
      }

      const user: UserRecord = {
        id: idGenerator("user"),
        email,
        displayName,
        passwordHash: await hashPassword(input.password),
        passwordUpdatedAt: now()
      };
      const workspace: WorkspaceRecord = {
        id: idGenerator("workspace"),
        name: `${displayName} Workspace`,
        ownerUserId: user.id
      };

      const createdUser = await runDbOperation(
        "account_register_create_user",
        () => db.user.create({ data: user }),
        dbOperationTimeoutMs
      );
      const createdWorkspace = await runDbOperation(
        "account_register_create_workspace",
        () => db.workspace.create({ data: workspace }),
        dbOperationTimeoutMs
      );
      await runDbOperation(
        "account_register_create_workspace_member",
        () =>
          db.workspaceMember.create({
            data: {
              workspaceId: createdWorkspace.id,
              userId: createdUser.id,
              role: "owner"
            }
          }),
        dbOperationTimeoutMs
      );

      return {
        user: createdUser,
        workspace: createdWorkspace
      };
    },

    async login(input: LoginInput) {
      const email = normalizeEmail(input.email);
      const user = await retryDbOperation(
        "account_login_find_user",
        () => db.user.findUnique({ where: { email } }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
        return null;
      }

      return user;
    },

    async findDefaultWorkspace(userId: string) {
      return retryDbOperation(
        "account_find_default_workspace",
        () => db.workspace.findFirst({ where: { ownerUserId: userId } }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );
    }
  };
}

export const accountService = createAccountService(createPrismaAccountDb(prisma));

function createPrismaAccountDb(db: PrismaClient): AccountDb {
  return {
    user: {
      async create(args) {
        return normalizeUser(await db.user.create({ data: args.data as Prisma.UserCreateInput }));
      },
      async findUnique(args) {
        const user = await db.user.findUnique({ where: args.where as Prisma.UserWhereUniqueInput });
        return user ? normalizeUser(user) : null;
      }
    },
    workspace: {
      async create(args) {
        return normalizeWorkspace(
          await db.workspace.create({ data: args.data as Prisma.WorkspaceUncheckedCreateInput })
        );
      },
      async findFirst(args) {
        const workspace = await db.workspace.findFirst({ where: args.where });
        return workspace ? normalizeWorkspace(workspace) : null;
      }
    },
    workspaceMember: {
      async create(args) {
        return db.workspaceMember.create({
          data: args.data as Prisma.WorkspaceMemberUncheckedCreateInput
        }) as Promise<WorkspaceMemberRecord>;
      }
    }
  };
}

function normalizeUser(user: {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  passwordUpdatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    passwordHash: user.passwordHash,
    passwordUpdatedAt: user.passwordUpdatedAt
  };
}

function normalizeWorkspace(workspace: { id: string; name: string; ownerUserId: string }) {
  return {
    id: workspace.id,
    name: workspace.name,
    ownerUserId: workspace.ownerUserId
  };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeDisplayName(displayName: string | undefined, email: string) {
  const trimmed = displayName?.trim();
  if (trimmed) {
    return trimmed;
  }

  return email.split("@")[0] || "Abitat User";
}

function validateEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error("Enter a valid email address");
  }
}

function validatePassword(password: string) {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
}

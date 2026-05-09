import { cookies } from "next/headers";

import { randomId } from "../crypto";
import { prisma } from "../db/client";
import {
  DEFAULT_DB_OPERATION_RETRIES,
  DEFAULT_DB_OPERATION_TIMEOUT_MS,
  retryDbOperation,
  runDbOperation
} from "../db/operation";
import { SESSION_COOKIE_NAME, getSessionSecret, verifySessionToken } from "./session";

export interface AccountContext {
  userId: string;
  workspaceId: string;
  hostMachineId: string;
}

export async function getRequestAccountContext(request: Request): Promise<AccountContext> {
  const userId = await getRequestSessionUserId(request);
  if (!userId) {
    throw new Error("Authentication required");
  }

  return getAccountContextForUserId(userId);
}

export async function getServerAccountContext(): Promise<AccountContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token, getSessionSecret());
  if (!session) {
    throw new Error("Authentication required");
  }

  return getAccountContextForUserId(session.userId);
}

export async function getRequestSessionUserId(request: Request) {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  const session = await verifySessionToken(token, getSessionSecret());
  return session ? session.userId : null;
}

export async function getAccountContextForUserId(userId: string): Promise<AccountContext> {
  let workspace = await retryDbOperation(
    "account_context_find_workspace",
    () =>
      prisma.workspace.findFirst({
        where: { ownerUserId: userId },
        orderBy: { createdAt: "asc" }
      }),
    {
      retries: DEFAULT_DB_OPERATION_RETRIES,
      timeoutMs: DEFAULT_DB_OPERATION_TIMEOUT_MS
    }
  );

  if (!workspace) {
    const createdWorkspace = await runDbOperation(
      "account_context_create_workspace",
      () =>
        prisma.workspace.create({
          data: {
            id: randomId("workspace"),
            name: "Abitat Workspace",
            ownerUserId: userId
          }
        }),
      DEFAULT_DB_OPERATION_TIMEOUT_MS
    );
    workspace = createdWorkspace;
    await runDbOperation(
      "account_context_create_workspace_member",
      () =>
        prisma.workspaceMember.create({
          data: {
            workspaceId: createdWorkspace.id,
            userId,
            role: "owner"
          }
        }),
      DEFAULT_DB_OPERATION_TIMEOUT_MS
    );
  }
  const workspaceId = workspace.id;

  let host = await retryDbOperation(
    "account_context_find_host",
    () =>
      prisma.machine.findFirst({
        where: {
          workspaceId,
          ownerUserId: userId,
          type: "host"
        },
        orderBy: { createdAt: "asc" }
      }),
    {
      retries: DEFAULT_DB_OPERATION_RETRIES,
      timeoutMs: DEFAULT_DB_OPERATION_TIMEOUT_MS
    }
  );

  if (!host) {
    host = await runDbOperation(
      "account_context_create_host",
      () =>
        prisma.machine.create({
          data: {
            id: randomId("machine"),
            workspaceId,
            ownerUserId: userId,
            name: "Mac Host",
            type: "host",
            status: "pending",
            platform: "darwin",
            deviceKind: "host",
            capabilitiesJson: ["codex", "claude", "screen_capture", "input_control"],
            installedToolsJson: []
          }
        }),
      DEFAULT_DB_OPERATION_TIMEOUT_MS
    );
  }

  return {
    userId,
    workspaceId,
    hostMachineId: host.id
  };
}

function readCookie(cookieHeader: string | null, name: string) {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

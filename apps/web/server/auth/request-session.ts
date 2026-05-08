import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import { prisma } from "../db/client";
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
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error("Authentication required");
  }

  let workspace = await prisma.workspace.findFirst({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" }
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        id: randomId("workspace"),
        name: `${user.displayName} Workspace`,
        ownerUserId: userId
      }
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId,
        role: "owner"
      }
    });
  }

  let host = await prisma.machine.findFirst({
    where: {
      workspaceId: workspace.id,
      ownerUserId: userId,
      type: "host"
    },
    orderBy: { createdAt: "asc" }
  });

  if (!host) {
    host = await prisma.machine.create({
      data: {
        id: randomId("machine"),
        workspaceId: workspace.id,
        ownerUserId: userId,
        name: "Mac Host",
        type: "host",
        status: "pending",
        platform: "darwin",
        deviceKind: "host",
        capabilitiesJson: ["codex", "claude", "screen_capture", "input_control"],
        installedToolsJson: []
      }
    });
  }

  return {
    userId,
    workspaceId: workspace.id,
    hostMachineId: host.id
  };
}

function randomId(prefix: string) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function readCookie(cookieHeader: string | null, name: string) {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

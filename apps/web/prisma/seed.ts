import { prisma } from "../server/db/client";

async function main() {
  await prisma.user.upsert({
    where: { email: "demo@abitat.local" },
    update: {
      displayName: "Demo User"
    },
    create: {
      id: "user_demo",
      email: "demo@abitat.local",
      displayName: "Demo User"
    }
  });

  await prisma.workspace.upsert({
    where: { id: "workspace_demo" },
    update: {
      name: "Demo Workspace"
    },
    create: {
      id: "workspace_demo",
      name: "Demo Workspace",
      ownerUserId: "user_demo"
    }
  });

  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: "workspace_demo",
        userId: "user_demo"
      }
    },
    update: {
      role: "owner"
    },
    create: {
      workspaceId: "workspace_demo",
      userId: "user_demo",
      role: "owner"
    }
  });

  await prisma.machine.upsert({
    where: { id: "machine_demo" },
    update: {
      status: "pending",
      ownerUserId: "user_demo",
      platform: "darwin",
      deviceKind: "host",
      capabilitiesJson: ["codex", "claude", "screen_capture", "input_control"]
    },
    create: {
      id: "machine_demo",
      workspaceId: "workspace_demo",
      ownerUserId: "user_demo",
      name: "Demo Host",
      type: "host",
      status: "pending",
      platform: "darwin",
      deviceKind: "host",
      pairingTokenHash: "demo-pairing-token-hash",
      capabilitiesJson: ["codex", "claude", "screen_capture", "input_control"],
      installedToolsJson: []
    }
  });

  await prisma.project.upsert({
    where: { id: "project_demo" },
    update: {
      repoUrl: "/Users/reece/Desktop/Test",
      hostLocalPath: "/Users/reece/Desktop/Test",
      repoSyncStatus: "ready"
    },
    create: {
      id: "project_demo",
      workspaceId: "workspace_demo",
      name: "Workspace",
      repoUrl: "/Users/reece/Desktop/Test",
      hostLocalPath: "/Users/reece/Desktop/Test",
      repoSyncStatus: "ready",
      createdByUserId: "user_demo"
    }
  });

  await prisma.agent.upsert({
    where: { id: "agent_demo" },
    update: {
      runtime: "mock"
    },
    create: {
      id: "agent_demo",
      projectId: "project_demo",
      name: "Mock Agent",
      role: "Careful coding agent",
      instructions: "Use the mock runtime and keep changes small.",
      model: "mock-model",
      runtime: "mock",
      allowedToolsJson: ["git", "node"],
      createdByUserId: "user_demo"
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

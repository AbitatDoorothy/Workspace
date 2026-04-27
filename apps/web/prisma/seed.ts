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
      status: "pending"
    },
    create: {
      id: "machine_demo",
      workspaceId: "workspace_demo",
      name: "Demo Host",
      type: "host",
      status: "pending",
      pairingTokenHash: "demo-pairing-token-hash",
      installedToolsJson: []
    }
  });

  await prisma.project.upsert({
    where: { id: "project_demo" },
    update: {
      repoUrl: "git@github.com:AbitatDoorothy/Workspace.git"
    },
    create: {
      id: "project_demo",
      workspaceId: "workspace_demo",
      name: "Workspace",
      repoUrl: "git@github.com:AbitatDoorothy/Workspace.git",
      defaultBranch: "main",
      githubOwner: "AbitatDoorothy",
      githubRepo: "Workspace",
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

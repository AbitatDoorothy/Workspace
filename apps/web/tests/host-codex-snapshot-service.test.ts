import { describe, expect, it } from "vitest";

import { createHostCodexSnapshotService } from "../server/hosts/codex-snapshot-service";

function createSnapshotDb() {
  const machines = new Map<
    string,
    { id: string; workspaceId: string; type: string; capabilitiesJson?: unknown }
  >();

  machines.set("machine_1", {
    id: "machine_1",
    workspaceId: "workspace_1",
    type: "host",
    capabilitiesJson: ["codex"]
  });

  return {
    machine: {
      findUnique: async ({ where }: { where: { id: string } }) => machines.get(where.id) ?? null,
      update: async ({
        data,
        where
      }: {
        data: { capabilitiesJson: unknown; lastSeenAt?: Date; status?: "online" };
        where: { id: string };
      }) => {
        const current = machines.get(where.id);
        if (!current) {
          throw new Error(`Missing machine ${where.id}`);
        }
        const next = { ...current, ...data };
        machines.set(where.id, next);
        return next;
      }
    },
    state: { machines }
  };
}

describe("host Codex snapshot service", () => {
  it("records signed-host snapshots without a pre-update host lookup", async () => {
    const db = createSnapshotDb();
    const service = createHostCodexSnapshotService(db);
    let findUniqueAttempts = 0;
    db.machine.findUnique = async () => {
      findUniqueAttempts += 1;
      throw new Error("Signed host snapshots should not read before update");
    };

    await expect(
      service.recordSnapshot({
        machineId: "machine_1",
        signedHost: { machineId: "machine_1", workspaceId: "workspace_1" },
        snapshot: {
          projects: [
            {
              conversationCount: 1,
              createdByUserId: "user_demo",
              hostLocalPath: "/tmp/project",
              id: "project_1",
              name: "Project",
              repoSyncStatus: "codex_app",
              repoUrl: "/tmp/project",
              source: "codex_app",
              updatedAt: "2026-05-09T00:00:00.000Z",
              workspaceId: "workspace_demo"
            }
          ]
        }
      })
    ).resolves.toMatchObject({
      projects: [expect.objectContaining({ id: "project_1", workspaceId: "workspace_1" })]
    });
    expect(findUniqueAttempts).toBe(0);
  });

  it("trims large snapshots before storing them on the host row", async () => {
    const db = createSnapshotDb();
    const service = createHostCodexSnapshotService(db);
    const messages = Array.from({ length: 120 }, (_, index) => ({
      id: `message_${index}`,
      conversationId: "conversation_1",
      sequence: index + 1,
      role: index % 2 === 0 ? ("runtime" as const) : ("assistant" as const),
      sourceDeviceId: null,
      content: "x".repeat(8_000),
      metadata: {},
      createdAt: "2026-05-09T00:00:00.000Z"
    }));

    const snapshot = await service.recordSnapshot({
      machineId: "machine_1",
      signedHost: { machineId: "machine_1", workspaceId: "workspace_1" },
      snapshot: {
        conversations: [
          {
            agentId: "codex_app",
            branchName: null,
            codexDeepLink: "codex://threads/thread_1",
            createdAt: new Date("2026-05-09T00:00:00.000Z"),
            createdByUserId: "user_demo",
            id: "conversation_1",
            projectId: "project_1",
            prompt: "Project",
            runtimeSessionId: "thread_1",
            source: "codex_app",
            status: "approved",
            type: "investigation",
            updatedAt: new Date("2026-05-09T00:00:00.000Z"),
            workspaceId: "workspace_demo",
            worktreePath: "/tmp/project"
          }
        ],
        messages: { conversation_1: messages },
        projects: [
          {
            conversationCount: 1,
            createdByUserId: "user_demo",
            hostLocalPath: "/tmp/project",
            id: "project_1",
            name: "Project",
            repoSyncStatus: "codex_app",
            repoUrl: "/tmp/project",
            source: "codex_app",
            updatedAt: "2026-05-09T00:00:00.000Z",
            workspaceId: "workspace_demo"
          }
        ]
      }
    });

    expect(snapshot.messages.conversation_1).toHaveLength(60);
    expect(snapshot.messages.conversation_1.every((message) => message.role !== "runtime")).toBe(
      true
    );
    expect(snapshot.messages.conversation_1[0].content.length).toBeLessThan(4_200);
  });
});

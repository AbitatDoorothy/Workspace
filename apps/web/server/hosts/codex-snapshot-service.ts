import type { CodexModelOption } from "@abitat_reece/shared";

import type {
  CodexAppConversationSummary,
  CodexAppMessage,
  CodexAppProjectSummary,
  CodexCompletionState
} from "../codex-app";

interface HostMachineRecord {
  id: string;
  workspaceId: string;
  ownerUserId?: string | null;
  type: "host" | "client" | string;
  capabilitiesJson?: unknown;
}

export interface HostCodexSnapshot {
  completions: CodexCompletionState[];
  conversations: CodexAppConversationSummary[];
  messages: Record<string, CodexAppMessage[]>;
  models: CodexModelOption[];
  projects: CodexAppProjectSummary[];
  syncedAt: string;
}

interface HostCodexSnapshotDb {
  machine: {
    findUnique(args: { where: { id: string } }): Promise<HostMachineRecord | null>;
    update(args: {
      where: { id: string };
      data: { capabilitiesJson: unknown; lastSeenAt?: Date; status?: "online" };
    }): Promise<HostMachineRecord>;
  };
}

interface HostCodexSnapshotInput {
  completions?: CodexCompletionState[];
  conversations?: CodexAppConversationSummary[];
  messages?: Record<string, CodexAppMessage[]>;
  models?: CodexModelOption[];
  projects?: CodexAppProjectSummary[];
  syncedAt?: string;
}

export function createHostCodexSnapshotService(db: HostCodexSnapshotDb) {
  return {
    async recordSnapshot(input: { machineId: string; snapshot: HostCodexSnapshotInput }) {
      const host = await db.machine.findUnique({ where: { id: input.machineId } });

      if (!host || host.type !== "host") {
        throw new Error("Host machine not found");
      }

      const capabilities = normalizeHostCapabilities(host.capabilitiesJson);
      const snapshot = scopeSnapshot(host, input.snapshot);

      await db.machine.update({
        where: { id: host.id },
        data: {
          capabilitiesJson: {
            ...capabilities,
            codexAppSnapshot: snapshot
          },
          lastSeenAt: new Date(),
          status: "online"
        }
      });

      return snapshot;
    },

    async getSnapshotForHost(input: { hostMachineId: string | null; workspaceId: string }) {
      if (!input.hostMachineId) {
        return null;
      }

      const host = await db.machine.findUnique({ where: { id: input.hostMachineId } });
      if (!host || host.type !== "host" || host.workspaceId !== input.workspaceId) {
        return null;
      }

      return normalizeSnapshot(normalizeHostCapabilities(host.capabilitiesJson).codexAppSnapshot);
    },

    async listProjects(input: { hostMachineId: string | null; workspaceId: string }) {
      return (await this.getSnapshotForHost(input))?.projects ?? [];
    },

    async getProject(input: {
      hostMachineId: string | null;
      projectId: string;
      workspaceId: string;
    }) {
      return (
        (await this.getSnapshotForHost(input))?.projects.find(
          (project) => project.id === input.projectId
        ) ?? null
      );
    },

    async listProjectConversations(input: {
      hostMachineId: string | null;
      projectId: string;
      workspaceId: string;
    }) {
      return (
        (await this.getSnapshotForHost(input))?.conversations.filter(
          (conversation) => conversation.projectId === input.projectId
        ) ?? []
      );
    },

    async getConversation(input: {
      conversationId: string;
      hostMachineId: string | null;
      workspaceId: string;
    }) {
      return (
        (await this.getSnapshotForHost(input))?.conversations.find(
          (conversation) => conversation.id === input.conversationId
        ) ?? null
      );
    },

    async listMessages(input: {
      afterSequence?: number;
      conversationId: string;
      hostMachineId: string | null;
      includeRuntime?: boolean;
      workspaceId: string;
    }) {
      const messages = (await this.getSnapshotForHost(input))?.messages[input.conversationId] ?? [];
      const filteredMessages = input.includeRuntime
        ? messages
        : messages.filter((message) => message.role !== "runtime");

      if (typeof input.afterSequence !== "number") {
        return filteredMessages;
      }

      const maxSequence = filteredMessages.reduce(
        (max, message) => Math.max(max, message.sequence),
        0
      );

      if (filteredMessages.length > 0 && input.afterSequence > maxSequence) {
        return filteredMessages;
      }

      return filteredMessages.filter((message) => message.sequence > input.afterSequence!);
    },

    async listCompletionStates(input: { hostMachineId: string | null; workspaceId: string }) {
      return (await this.getSnapshotForHost(input))?.completions ?? [];
    },

    async listModelOptions(input: { hostMachineId: string | null; workspaceId: string }) {
      return (await this.getSnapshotForHost(input))?.models ?? [];
    }
  };
}

function scopeSnapshot(
  host: Pick<HostMachineRecord, "ownerUserId" | "workspaceId">,
  input: HostCodexSnapshotInput
): HostCodexSnapshot {
  const syncedAt =
    typeof input.syncedAt === "string" && isIsoDateTime(input.syncedAt)
      ? input.syncedAt
      : new Date().toISOString();
  const userId = host.ownerUserId ?? "user_demo";

  return {
    completions: (input.completions ?? []).map((completion) => ({
      ...completion,
      workspaceId: host.workspaceId
    })),
    conversations: (input.conversations ?? []).map((conversation) => ({
      ...conversation,
      createdByUserId: userId,
      workspaceId: host.workspaceId
    })),
    messages: Object.fromEntries(
      Object.entries(input.messages ?? {}).map(([conversationId, messages]) => [
        conversationId,
        messages.map((message) => ({
          ...message,
          conversationId
        }))
      ])
    ),
    models: input.models ?? [],
    projects: (input.projects ?? []).map((project) => ({
      ...project,
      createdByUserId: userId,
      workspaceId: host.workspaceId
    })),
    syncedAt
  };
}

function normalizeHostCapabilities(value: unknown) {
  if (Array.isArray(value)) {
    return {
      codexAppSnapshot: null,
      features: value.filter((feature): feature is string => typeof feature === "string")
    };
  }

  if (!value || typeof value !== "object") {
    return {
      codexAppSnapshot: null,
      features: []
    };
  }

  const candidate = value as { codexAppSnapshot?: unknown; features?: unknown };

  return {
    ...candidate,
    codexAppSnapshot: candidate.codexAppSnapshot ?? null,
    features: Array.isArray(candidate.features)
      ? candidate.features.filter((feature): feature is string => typeof feature === "string")
      : []
  };
}

function normalizeSnapshot(value: unknown): HostCodexSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<HostCodexSnapshot>;

  return {
    completions: Array.isArray(candidate.completions) ? candidate.completions : [],
    conversations: Array.isArray(candidate.conversations) ? candidate.conversations : [],
    messages:
      candidate.messages &&
      typeof candidate.messages === "object" &&
      !Array.isArray(candidate.messages)
        ? Object.fromEntries(
            Object.entries(candidate.messages).map(([conversationId, messages]) => [
              conversationId,
              Array.isArray(messages) ? messages : []
            ])
          )
        : {},
    models: Array.isArray(candidate.models) ? candidate.models : [],
    projects: Array.isArray(candidate.projects) ? candidate.projects : [],
    syncedAt:
      typeof candidate.syncedAt === "string" ? candidate.syncedAt : new Date(0).toISOString()
  };
}

function isIsoDateTime(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export type HostCodexSnapshotService = ReturnType<typeof createHostCodexSnapshotService>;

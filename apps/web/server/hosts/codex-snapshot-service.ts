import type { CodexModelOption } from "@abitat_reece/shared";

import type {
  CodexAppConversationSummary,
  CodexAppMessage,
  CodexAppProjectSummary,
  CodexCompletionState
} from "../codex-app";
import { DEFAULT_DB_OPERATION_TIMEOUT_MS, retryDbOperation } from "../db/operation";
import type { SignedHostTokenActor } from "./host-service";

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

const DEFAULT_HOST_FEATURES = ["codex", "claude", "screen_capture", "input_control"];
const MAX_SNAPSHOT_COMPLETIONS = 80;
const MAX_SNAPSHOT_CONVERSATIONS = 80;
const MAX_SNAPSHOT_MESSAGES_PER_CONVERSATION = 80;
const MAX_SNAPSHOT_MESSAGE_CONTENT_LENGTH = 4_000;
const MAX_SNAPSHOT_MODELS = 40;
const MAX_SNAPSHOT_PROJECTS = 80;
const SNAPSHOT_DB_RETRIES = 2;
const SNAPSHOT_DB_TIMEOUT_MS = DEFAULT_DB_OPERATION_TIMEOUT_MS;

export function createHostCodexSnapshotService(db: HostCodexSnapshotDb) {
  return {
    async recordSnapshot(input: {
      machineId: string;
      signedHost?: SignedHostTokenActor | null;
      snapshot: HostCodexSnapshotInput;
    }) {
      const host =
        input.signedHost?.machineId === input.machineId
          ? signedHostRecord(input.signedHost)
          : await retryDbOperation(
              "host_codex_snapshot_find_host",
              () => db.machine.findUnique({ where: { id: input.machineId } }),
              {
                retries: SNAPSHOT_DB_RETRIES,
                timeoutMs: SNAPSHOT_DB_TIMEOUT_MS
              }
            );

      if (!host || host.type !== "host") {
        throw new Error("Host machine not found");
      }

      const capabilities = normalizeHostCapabilities(host.capabilitiesJson);
      const snapshot = scopeSnapshot(host, input.snapshot);

      await retryDbOperation(
        "host_codex_snapshot_update_host",
        () =>
          db.machine.update({
            where: { id: host.id },
            data: {
              capabilitiesJson: {
                ...capabilities,
                codexAppSnapshot: snapshot
              },
              lastSeenAt: new Date(),
              status: "online"
            }
          }),
        {
          retries: SNAPSHOT_DB_RETRIES,
          timeoutMs: SNAPSHOT_DB_TIMEOUT_MS
        }
      );

      return snapshot;
    },

    async getSnapshotForHost(input: { hostMachineId: string | null; workspaceId: string }) {
      if (!input.hostMachineId) {
        return null;
      }

      const hostMachineId = input.hostMachineId;
      const host = await retryDbOperation(
        "host_codex_snapshot_get_host",
        () => db.machine.findUnique({ where: { id: hostMachineId } }),
        {
          retries: SNAPSHOT_DB_RETRIES,
          timeoutMs: SNAPSHOT_DB_TIMEOUT_MS
        }
      );
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

function signedHostRecord(host: SignedHostTokenActor): HostMachineRecord {
  return {
    id: host.machineId,
    workspaceId: host.workspaceId,
    ownerUserId: null,
    type: "host",
    capabilitiesJson: DEFAULT_HOST_FEATURES
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
  const projects = (input.projects ?? []).slice(0, MAX_SNAPSHOT_PROJECTS);
  const projectIds = new Set(projects.map((project) => project.id));
  const conversations = (input.conversations ?? [])
    .filter((conversation) => projectIds.size === 0 || projectIds.has(conversation.projectId))
    .slice(0, MAX_SNAPSHOT_CONVERSATIONS);
  const conversationIds = new Set(conversations.map((conversation) => conversation.id));

  return {
    completions: (input.completions ?? [])
      .filter((completion) => conversationIds.has(completion.conversationId))
      .slice(0, MAX_SNAPSHOT_COMPLETIONS)
      .map((completion) => ({
        ...completion,
        workspaceId: host.workspaceId
      })),
    conversations: conversations.map((conversation) => ({
      ...conversation,
      createdByUserId: userId,
      workspaceId: host.workspaceId
    })),
    messages: Object.fromEntries(
      Object.entries(input.messages ?? {})
        .filter(([conversationId]) => conversationIds.has(conversationId))
        .map(([conversationId, messages]) => [
          conversationId,
          messages
            .filter((message) => message.role !== "runtime")
            .slice(-MAX_SNAPSHOT_MESSAGES_PER_CONVERSATION)
            .map((message) => ({
              ...message,
              content: truncateSnapshotMessage(message.content),
              conversationId
            }))
        ])
    ),
    models: (input.models ?? []).slice(0, MAX_SNAPSHOT_MODELS),
    projects: projects.map((project) => ({
      ...project,
      createdByUserId: userId,
      workspaceId: host.workspaceId
    })),
    syncedAt
  };
}

function truncateSnapshotMessage(content: string) {
  if (content.length <= MAX_SNAPSHOT_MESSAGE_CONTENT_LENGTH) {
    return content;
  }

  return `${content.slice(0, MAX_SNAPSHOT_MESSAGE_CONTENT_LENGTH)}\n\n[truncated for mobile sync]`;
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

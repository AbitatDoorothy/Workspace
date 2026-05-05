import { createHash } from "node:crypto";
import { basename, normalize } from "node:path";

import type { ConversationStatus, ConversationType } from "@abitat/shared";

import { createCodexAppClient } from "./codex-app-client";

const CODEX_PROJECT_PREFIX = "codex_project_";
const CODEX_THREAD_PREFIX = "codex_thread_";
const DEFAULT_WORKSPACE_ID = "workspace_demo";
const DEFAULT_USER_ID = "user_demo";

export type CodexAppThreadStatus =
  | { type: "active"; activeFlags?: unknown[] }
  | { type: "idle" }
  | { type: "notLoaded" }
  | { type: "systemError" };

export type CodexAppSessionSource =
  | "cli"
  | "vscode"
  | "exec"
  | "appServer"
  | "unknown"
  | Record<string, unknown>;

export type CodexAppUserInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type CodexAppThreadItem =
  | { type: "userMessage"; id: string; content: CodexAppUserInput[] }
  | {
      type: "agentMessage";
      id: string;
      text: string;
      phase: unknown | null;
      memoryCitation: unknown | null;
    }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      processId: string | null;
      source: string;
      status: string;
      commandActions: unknown[];
      aggregatedOutput: string | null;
      exitCode: number | null;
      durationMs: number | null;
    }
  | { type: "fileChange"; id: string; changes: unknown[]; status: string };

export interface CodexAppTurn {
  id: string;
  items: CodexAppThreadItem[];
  status: unknown;
  error: unknown | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

export interface CodexAppThread {
  id: string;
  forkedFromId: string | null;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: CodexAppThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: CodexAppSessionSource;
  agentNickname?: string | null;
  agentRole?: string | null;
  gitInfo: unknown | null;
  name: string | null;
  turns: CodexAppTurn[];
}

export interface CodexAppThreadListParams {
  archived?: boolean | null;
  cursor?: string | null;
  cwd?: string | string[] | null;
  limit?: number | null;
  sortDirection?: "asc" | "desc" | null;
  sortKey?: string | null;
  useStateDbOnly?: boolean;
}

export interface CodexAppThreadListResponse {
  data: CodexAppThread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export interface CodexAppClient {
  listThreads(params?: CodexAppThreadListParams): Promise<CodexAppThreadListResponse>;
  readThread(threadId: string, includeTurns?: boolean): Promise<CodexAppThread>;
  resumeThread(params: {
    excludeTurns?: boolean;
    threadId: string;
  }): Promise<{ thread: CodexAppThread }>;
  startThread(params: {
    cwd?: string | null;
    experimentalRawEvents?: boolean;
    persistExtendedHistory?: boolean;
  }): Promise<{ thread: CodexAppThread }>;
  startTurn(threadId: string, input: CodexAppUserInput[]): Promise<{ turn: CodexAppTurn }>;
}

export interface CodexAppProjectSummary {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  hostLocalPath: string;
  createdByUserId: string;
  repoSyncStatus: "codex_app";
  conversationCount: number;
  source: "codex_app";
  updatedAt: string;
}

export interface CodexAppConversationSummary {
  id: string;
  workspaceId: string;
  projectId: string;
  agentId: "codex_app";
  createdByUserId: string;
  type: ConversationType;
  status: ConversationStatus;
  prompt: string;
  branchName: null;
  runtimeSessionId: string;
  worktreePath: string;
  source: "codex_app";
  codexDeepLink: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CodexAppMessage {
  id: string;
  conversationId: string;
  sequence: number;
  role: "user" | "assistant" | "runtime";
  sourceDeviceId: null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface CodexAppServiceOptions {
  workspaceId?: string;
  userId?: string;
}

interface StartConversationInput {
  prompt: string;
}

export function createCodexAppService(
  client: CodexAppClient,
  options: CodexAppServiceOptions = {}
) {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const userId = options.userId ?? DEFAULT_USER_ID;

  async function listAllThreads(params: CodexAppThreadListParams = {}) {
    const threads: CodexAppThread[] = [];
    let cursor: string | null | undefined = params.cursor ?? null;

    do {
      const page = await client.listThreads({
        archived: false,
        limit: 200,
        sortDirection: "desc",
        useStateDbOnly: true,
        ...params,
        cursor
      });

      threads.push(...page.data.filter((thread) => !thread.ephemeral && thread.cwd));
      cursor = page.nextCursor;
    } while (cursor);

    return threads;
  }

  async function resolveProjectCwd(projectId: string) {
    if (!isCodexProjectId(projectId)) {
      throw new Error("Codex project not found");
    }

    const project = (await listProjects()).find((candidate) => candidate.id === projectId);

    if (!project) {
      throw new Error("Codex project not found");
    }

    return project.hostLocalPath;
  }

  async function listProjects(): Promise<CodexAppProjectSummary[]> {
    const grouped = new Map<string, { cwd: string; count: number; latestUpdatedAt: number }>();

    for (const thread of await listAllThreads()) {
      const current = grouped.get(thread.cwd);
      grouped.set(thread.cwd, {
        count: (current?.count ?? 0) + 1,
        cwd: thread.cwd,
        latestUpdatedAt: Math.max(current?.latestUpdatedAt ?? thread.updatedAt, thread.updatedAt)
      });
    }

    return [...grouped.values()]
      .sort((left, right) => right.latestUpdatedAt - left.latestUpdatedAt)
      .map((project) => ({
        conversationCount: project.count,
        createdByUserId: userId,
        hostLocalPath: project.cwd,
        id: externalCodexProjectId(project.cwd),
        name: projectNameFromCwd(project.cwd),
        repoSyncStatus: "codex_app",
        repoUrl: project.cwd,
        source: "codex_app",
        updatedAt: secondsToIso(project.latestUpdatedAt),
        workspaceId
      }));
  }

  async function listProjectConversations(
    projectId: string
  ): Promise<CodexAppConversationSummary[]> {
    const cwd = await resolveProjectCwd(projectId);
    const threads = await listAllThreads({ cwd });

    return threads
      .filter((thread) => externalCodexProjectId(thread.cwd) === projectId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((thread) => codexThreadToConversation(thread, workspaceId, userId));
  }

  return {
    getProject: async (projectId: string) =>
      (await listProjects()).find((project) => project.id === projectId) ?? null,

    getConversation: async (conversationId: string) => {
      const thread = await client.readThread(toCodexThreadId(conversationId), false);
      return codexThreadToConversation(thread, workspaceId, userId);
    },

    listProjects,

    listProjectConversations,

    async listMessages(conversationId: string, options: { afterSequence?: number } = {}) {
      const threadId = toCodexThreadId(conversationId);
      const thread = await client.readThread(threadId, true);
      const messages = flattenThreadMessages(thread, externalCodexConversationId(threadId));

      return typeof options.afterSequence === "number"
        ? messages.filter((message) => message.sequence > options.afterSequence!)
        : messages;
    },

    async startConversation(projectId: string, input: StartConversationInput) {
      const prompt = normalizedPrompt(input.prompt);
      const cwd = await resolveProjectCwd(projectId);
      const { thread } = await client.startThread({
        cwd,
        experimentalRawEvents: false,
        persistExtendedHistory: true
      });
      await client.startTurn(thread.id, textInput(prompt));

      return {
        conversationId: externalCodexConversationId(thread.id),
        status: "running" as ConversationStatus
      };
    },

    async continueConversation(conversationId: string, input: StartConversationInput) {
      const threadId = toCodexThreadId(conversationId);
      const prompt = normalizedPrompt(input.prompt);
      let resumed = false;
      const resumeThread = async () => {
        if (resumed) {
          return;
        }

        await client.resumeThread({ excludeTurns: true, threadId });
        resumed = true;
      };

      const thread = await client.readThread(threadId, false);
      if (thread.status.type === "systemError") {
        throw new Error(
          "Codex app thread is in a system error state. Open it on the Mac and resolve the error, or start a new Codex thread from the phone."
        );
      }

      if (thread.status.type === "notLoaded") {
        await resumeThread();
      }

      try {
        await client.startTurn(threadId, textInput(prompt));
      } catch (error) {
        if (!isThreadNotFoundError(error, threadId)) {
          throw error;
        }

        await resumeThread();
        await client.startTurn(threadId, textInput(prompt));
      }

      return {
        conversationId: externalCodexConversationId(threadId),
        status: "running" as ConversationStatus
      };
    }
  };
}

export const codexAppService = createCodexAppService(createCodexAppClient());

export type CodexAppService = ReturnType<typeof createCodexAppService>;

export function externalCodexProjectId(cwd: string) {
  return `${CODEX_PROJECT_PREFIX}${createHash("sha256").update(normalize(cwd)).digest("hex").slice(0, 16)}`;
}

export function isCodexProjectId(projectId: string) {
  return projectId.startsWith(CODEX_PROJECT_PREFIX);
}

export function externalCodexConversationId(threadId: string) {
  return `${CODEX_THREAD_PREFIX}${encodeURIComponent(threadId)}`;
}

export function isCodexConversationId(conversationId: string) {
  return conversationId.startsWith(CODEX_THREAD_PREFIX);
}

export function toCodexThreadId(conversationId: string) {
  return isCodexConversationId(conversationId)
    ? decodeURIComponent(conversationId.slice(CODEX_THREAD_PREFIX.length))
    : conversationId;
}

export function codexAppDeepLink(threadId: string) {
  return `codex://threads/${encodeURIComponent(threadId)}`;
}

export function codexThreadToConversation(
  thread: CodexAppThread,
  workspaceId = DEFAULT_WORKSPACE_ID,
  userId = DEFAULT_USER_ID
): CodexAppConversationSummary {
  return {
    agentId: "codex_app",
    branchName: null,
    codexDeepLink: codexAppDeepLink(thread.id),
    createdAt: secondsToDate(thread.createdAt),
    createdByUserId: userId,
    id: externalCodexConversationId(thread.id),
    projectId: externalCodexProjectId(thread.cwd),
    prompt: codexThreadTitle(thread),
    runtimeSessionId: thread.id,
    source: "codex_app",
    status: codexThreadStatusToConversationStatus(thread.status),
    type: "investigation",
    updatedAt: secondsToDate(thread.updatedAt),
    workspaceId,
    worktreePath: thread.cwd
  };
}

export function flattenThreadMessages(
  thread: CodexAppThread,
  conversationId = externalCodexConversationId(thread.id)
): CodexAppMessage[] {
  const messages: CodexAppMessage[] = [];
  let sequence = 1;

  for (const turn of thread.turns) {
    for (const item of turn.items) {
      const flattened = threadItemToMessageContent(item);

      if (!flattened) {
        continue;
      }

      messages.push({
        content: flattened.content,
        conversationId,
        createdAt: itemCreatedAt(thread, turn, sequence),
        id: `${conversationId}_${item.id ?? sequence}`,
        metadata: {
          codexItemId: item.id ?? null,
          codexItemType: item.type,
          codexThreadId: thread.id,
          codexTurnId: turn.id
        },
        role: flattened.role,
        sequence,
        sourceDeviceId: null
      });
      sequence += 1;
    }
  }

  return messages;
}

function codexThreadStatusToConversationStatus(status: CodexAppThreadStatus): ConversationStatus {
  if (status.type === "active") {
    return "running";
  }

  if (status.type === "systemError") {
    return "failed";
  }

  return "approved";
}

function codexThreadTitle(thread: CodexAppThread) {
  return thread.name?.trim() || thread.preview.trim() || "Untitled Codex thread";
}

function projectNameFromCwd(cwd: string) {
  return basename(normalize(cwd)) || cwd;
}

function threadItemToMessageContent(
  item: CodexAppThreadItem
): { role: CodexAppMessage["role"]; content: string } | null {
  if (item.type === "userMessage") {
    const content = item.content.map(userInputToText).filter(Boolean).join("\n").trim();
    return content ? { content, role: "user" } : null;
  }

  if (item.type === "agentMessage") {
    const content = item.text.trim();
    return content ? { content, role: "assistant" } : null;
  }

  if (item.type === "plan") {
    const content = item.text.trim();
    return content ? { content, role: "assistant" } : null;
  }

  if (item.type === "commandExecution") {
    const content = (item.aggregatedOutput ?? item.command).trim();
    return content ? { content, role: "runtime" } : null;
  }

  if (item.type === "fileChange") {
    return {
      content: `Updated ${item.changes.length} file${item.changes.length === 1 ? "" : "s"}.`,
      role: "runtime"
    };
  }

  return null;
}

function userInputToText(input: CodexAppUserInput) {
  switch (input.type) {
    case "text":
      return input.text;
    case "image":
      return `[Image: ${input.url}]`;
    case "localImage":
      return `[Local image: ${input.path}]`;
    case "skill":
      return `[Skill: ${input.name}]`;
    case "mention":
      return `[Mention: ${input.name}]`;
  }
}

function textInput(prompt: string): CodexAppUserInput[] {
  return [{ text: prompt, text_elements: [], type: "text" }];
}

function normalizedPrompt(prompt: string) {
  const trimmed = prompt.trim();

  if (!trimmed) {
    throw new Error("Prompt is required");
  }

  return trimmed;
}

function isThreadNotFoundError(error: unknown, threadId: string) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("thread not found") && message.includes(threadId.toLowerCase());
}

function secondsToDate(seconds: number) {
  return new Date(seconds * 1000);
}

function secondsToIso(seconds: number) {
  return secondsToDate(seconds).toISOString();
}

function itemCreatedAt(thread: CodexAppThread, turn: CodexAppTurn, sequence: number) {
  const seconds = turn.startedAt ?? turn.completedAt ?? thread.updatedAt ?? thread.createdAt;
  return new Date(seconds * 1000 + sequence).toISOString();
}

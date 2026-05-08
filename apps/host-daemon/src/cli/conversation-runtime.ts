import type { RunEventIngestRequest } from "@abitat_reece/shared";

import type { RuntimeAdapter, RuntimeEvent } from "../runtime/adapter.js";

interface RunEventClient {
  ingestRunEvent(conversationId: string, input: RunEventIngestRequest): Promise<unknown>;
}

interface RunConversationRuntimeInput {
  conversationId: string;
  worktreePath: string;
  prompt: string;
  model?: string;
  instructions: string;
  allowedTools: string[];
  captureSummary?: boolean;
  resumeSessionId?: string;
  skipGitRepoCheck?: boolean;
}

interface RunConversationRuntimeOptions {
  eventIngestAttempts?: number;
  eventIngestRetryDelayMs?: number;
}

const DEFAULT_EVENT_INGEST_ATTEMPTS = 5;
const DEFAULT_EVENT_INGEST_RETRY_DELAY_MS = 250;

export async function runConversationRuntime(
  client: RunEventClient,
  adapter: RuntimeAdapter,
  input: RunConversationRuntimeInput,
  options: RunConversationRuntimeOptions = {}
) {
  let sequence = 1;
  let runtimeSessionId = input.resumeSessionId;
  const summaryLines: string[] = [];
  const ingestOptions = {
    attempts: Math.max(1, options.eventIngestAttempts ?? DEFAULT_EVENT_INGEST_ATTEMPTS),
    retryDelayMs: Math.max(
      0,
      options.eventIngestRetryDelayMs ?? DEFAULT_EVENT_INGEST_RETRY_DELAY_MS
    )
  };

  await adapter.run(input, async (event: RuntimeEvent) => {
    runtimeSessionId = runtimeSessionId ?? parseRuntimeSessionId(event.content);
    if (input.captureSummary && event.type === "stdout") {
      summaryLines.push(event.content);
    }

    await ingestRunEvent(
      client,
      input.conversationId,
      {
        sequence,
        type: event.type,
        content: event.content,
        metadata: {}
      },
      ingestOptions
    );
    sequence += 1;
  });

  if (input.captureSummary) {
    await ingestRunEvent(
      client,
      input.conversationId,
      {
        sequence,
        type: "summary",
        content: summaryText(summaryLines),
        metadata: { action: "summarize" }
      },
      ingestOptions
    );
  }

  return runtimeSessionId;
}

async function ingestRunEvent(
  client: RunEventClient,
  conversationId: string,
  input: RunEventIngestRequest,
  options: { attempts: number; retryDelayMs: number }
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      await client.ingestRunEvent(conversationId, input);
      return;
    } catch (error) {
      lastError = error;

      if (attempt < options.attempts) {
        await delay(options.retryDelayMs);
      }
    }
  }

  console.warn(
    `run event ingest failed for ${conversationId} sequence ${input.sequence}: ${errorMessage(
      lastError
    )}`
  );
}

function parseRuntimeSessionId(content: string) {
  const trimmed = content.trim();
  const directMatch = /^session id:\s*(\S+)/i.exec(trimmed);
  const resumeMatch = /\bcodex resume\s+(\S+)/i.exec(trimmed);

  return directMatch?.[1] ?? resumeMatch?.[1];
}

function summaryText(lines: string[]) {
  const summary = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return summary || "Summary completed, but Codex did not return text.";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

function delay(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type MobileControlDiagnosticsLevel = "debug" | "info" | "warn" | "error";
export type MobileControlDiagnosticsFields = Record<string, unknown>;

export interface MobileControlDiagnosticsLogger {
  flush?(): Promise<void>;
  log(
    level: MobileControlDiagnosticsLevel,
    event: string,
    fields?: MobileControlDiagnosticsFields
  ): Promise<void> | void;
}

export interface MobileControlFileDiagnosticsLogger extends MobileControlDiagnosticsLogger {
  readonly logPath: string;
}

interface CreateMobileControlDiagnosticsLoggerOptions {
  activityWindowMs?: number;
  dedupeWindowMs?: number;
  logPath?: string;
  now?: () => Date;
}

const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN =
  /(?:authorization|authheader|rawauth|bearer|clienttoken|pairingsecret|pushtoken|token|secret|database64|rawheaders?)/iu;
const BEARER_VALUE_PATTERN = /Bearer\s+[-._~+/=A-Za-z0-9]+/gu;
const EXPO_PUSH_TOKEN_PATTERN = /(?:Expo|Exponent)PushToken\[[^\]]+\]/gu;
const DEFAULT_ACTIVITY_WINDOW_MS = 30_000;
const DEFAULT_DEDUPE_WINDOW_MS = 60_000;
const ACTIVE_STATUSES = new Set(["awaiting_approval", "queued", "running"]);
const LIFECYCLE_EVENTS = new Set([
  "codex.app_server.bootstrap_connected",
  "codex.app_server.bootstrap_start",
  "local_control.server_start",
  "pairing.consumed",
  "pairing.created",
  "relay.connect.closed",
  "relay.connect.open",
  "relay.reconnect.scheduled"
]);
const TASK_EVENTS = [
  "attachment.saved",
  "codex.turn_start.",
  "codex.turn_steer.",
  "conversation.continue.",
  "conversation.start.",
  "push.send.failure",
  "push.send.success"
];
const ACTIVITY_SCOPED_EVENTS = new Set([
  "codex.thread.messages_flattened",
  "codex.thread_read.call",
  "codex.thread_read.result",
  "completion.poll.result",
  "completion.states.list.result",
  "completion.states.result",
  "messages.list.result"
]);
const SUPPRESSED_IDLE_EVENTS = new Set([
  "codex.app_server.bootstrap",
  "completion.poll.start",
  "conversations.list.result",
  "mobile_request.authenticated",
  "projects.list.result"
]);
const SUPPRESSED_PUSH_SKIP_REASONS = new Set(["already_notified", "not_complete"]);

export function defaultMobileControlDiagnosticsLogPath() {
  return join(homedir(), "Library", "Logs", "Abitat", "mobile-control.log");
}

export function mobileControlDiagnosticsLogPath() {
  return process.env.ABITAT_MOBILE_CONTROL_LOG_PATH ?? defaultMobileControlDiagnosticsLogPath();
}

export function createMobileControlDiagnosticsLogger(
  options: CreateMobileControlDiagnosticsLoggerOptions = {}
): MobileControlFileDiagnosticsLogger {
  const logPath = options.logPath ?? mobileControlDiagnosticsLogPath();
  const now = options.now ?? (() => new Date());
  const activityWindowMs = options.activityWindowMs ?? DEFAULT_ACTIVITY_WINDOW_MS;
  const dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const recentWrites = new Map<string, number>();
  let activeUntilMs = 0;
  let directoryReady = false;
  let flushQueued = false;
  let pendingLines = "";
  let pendingWrite = Promise.resolve();

  function flushPendingLines() {
    flushQueued = false;
    const lines = pendingLines;
    pendingLines = "";

    if (!lines) {
      return pendingWrite;
    }

    pendingWrite = pendingWrite
      .then(async () => {
        if (!directoryReady) {
          await mkdir(dirname(logPath), { recursive: true });
          directoryReady = true;
        }
        await appendFile(logPath, lines, "utf8");
      })
      .catch(() => undefined);
    return pendingWrite;
  }

  function scheduleFlush() {
    if (flushQueued) {
      return;
    }

    flushQueued = true;
    queueMicrotask(flushPendingLines);
  }

  return {
    logPath,
    flush() {
      return flushPendingLines();
    },
    log(level, event, fields = {}) {
      const timestamp = now();
      const timestampMs = timestamp.getTime();
      const activity = diagnosticsActivity(level, event, fields);
      const isActive = activity.startsActivity || timestampMs <= activeUntilMs;

      if (activity.startsActivity) {
        activeUntilMs = Math.max(activeUntilMs, timestampMs + activityWindowMs);
      }

      const shouldWrite = shouldWriteDiagnosticsFileEntry(level, event, fields, isActive);
      if (activity.endsActivity) {
        activeUntilMs = 0;
      }

      if (!shouldWrite) {
        return;
      }

      const redactedFields = redactDiagnosticsFields(fields);
      if (shouldDedupeDiagnosticsFileEntry(level, event)) {
        const dedupeKey = JSON.stringify([level, event, stableDiagnosticsValue(redactedFields)]);
        const lastWrittenAt = recentWrites.get(dedupeKey) ?? 0;
        if (timestampMs - lastWrittenAt < dedupeWindowMs) {
          return;
        }
        recentWrites.set(dedupeKey, timestampMs);
        pruneRecentDiagnosticsWrites(recentWrites, timestampMs, dedupeWindowMs);
      }

      const entry = {
        timestamp: timestamp.toISOString(),
        level,
        event,
        ...redactedFields
      };
      const line = `${JSON.stringify(entry)}\n`;
      pendingLines += line;
      scheduleFlush();
      return pendingWrite;
    }
  };
}

export function logDiagnostics(
  logger: MobileControlDiagnosticsLogger | undefined,
  level: MobileControlDiagnosticsLevel,
  event: string,
  fields: MobileControlDiagnosticsFields = {}
) {
  try {
    const result = logger?.log(level, event, fields);
    if (result && typeof result === "object" && "catch" in result) {
      void result.catch(() => undefined);
    }
  } catch {
    // Diagnostics must never change the local-control request path.
  }
}

export function promptDiagnostics(prompt: string) {
  return {
    promptHash: createHash("sha256").update(prompt).digest("hex").slice(0, 16),
    promptLength: prompt.length
  };
}

export function attachmentDiagnostics(
  attachments: Array<{ kind?: string; type?: string }> | undefined
) {
  const attachmentKinds = attachments?.flatMap((attachment) =>
    typeof attachment.kind === "string"
      ? [attachment.kind]
      : typeof attachment.type === "string"
        ? [attachment.type]
        : []
  );

  return {
    attachmentCount: attachments?.length ?? 0,
    ...(attachmentKinds && attachmentKinds.length > 0 ? { attachmentKinds } : {})
  };
}

export function errorDiagnostics(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function redactDiagnosticsFields(fields: MobileControlDiagnosticsFields) {
  return redactDiagnosticsValue(fields) as MobileControlDiagnosticsFields;
}

function diagnosticsActivity(
  level: MobileControlDiagnosticsLevel,
  event: string,
  fields: MobileControlDiagnosticsFields
) {
  const startsActivity =
    level === "warn" ||
    level === "error" ||
    isTaskEvent(event) ||
    hasActiveStatus(fields) ||
    positiveNumberField(fields, "activeCount") ||
    positiveNumberField(fields, "runningCount") ||
    positiveNumberField(fields, "queuedCount");

  return {
    endsActivity:
      event === "completion.poll.result" &&
      !startsActivity &&
      fields.activeCount === 0 &&
      !hasActiveStatus(fields),
    startsActivity
  };
}

function shouldWriteDiagnosticsFileEntry(
  level: MobileControlDiagnosticsLevel,
  event: string,
  fields: MobileControlDiagnosticsFields,
  isActive: boolean
) {
  if (level === "error" || level === "warn") {
    return true;
  }

  if (level === "debug") {
    return false;
  }

  if (event === "push.send.skipped") {
    return !SUPPRESSED_PUSH_SKIP_REASONS.has(String(fields.reason ?? ""));
  }

  if (LIFECYCLE_EVENTS.has(event) || isTaskEvent(event)) {
    return true;
  }

  if (ACTIVITY_SCOPED_EVENTS.has(event)) {
    return isActive;
  }

  if (SUPPRESSED_IDLE_EVENTS.has(event)) {
    return false;
  }

  return true;
}

function shouldDedupeDiagnosticsFileEntry(level: MobileControlDiagnosticsLevel, event: string) {
  return (
    level === "info" &&
    (ACTIVITY_SCOPED_EVENTS.has(event) ||
      event === "push.send.skipped" ||
      event === "relay.reconnect.scheduled")
  );
}

function isTaskEvent(event: string) {
  return TASK_EVENTS.some((taskEvent) =>
    taskEvent.endsWith(".") ? event.startsWith(taskEvent) : event === taskEvent
  );
}

function hasActiveStatus(fields: MobileControlDiagnosticsFields) {
  return ACTIVE_STATUSES.has(String(fields.status ?? ""));
}

function positiveNumberField(fields: MobileControlDiagnosticsFields, key: string) {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function pruneRecentDiagnosticsWrites(
  recentWrites: Map<string, number>,
  timestampMs: number,
  dedupeWindowMs: number
) {
  if (recentWrites.size < 500) {
    return;
  }

  for (const [key, lastWrittenAt] of recentWrites.entries()) {
    if (timestampMs - lastWrittenAt >= dedupeWindowMs) {
      recentWrites.delete(key);
    }
  }
}

function stableDiagnosticsValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableDiagnosticsValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableDiagnosticsValue(child)])
    );
  }

  return value;
}

function redactDiagnosticsValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticsValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactDiagnosticsValue(entryValue, entryKey)
      ])
    );
  }

  if (typeof value === "string") {
    return value
      .replace(BEARER_VALUE_PATTERN, "Bearer [redacted]")
      .replace(EXPO_PUSH_TOKEN_PATTERN, REDACTED);
  }

  return value;
}

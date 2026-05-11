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
  logPath?: string;
  now?: () => Date;
}

const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN =
  /(?:authorization|authheader|rawauth|bearer|clienttoken|pairingsecret|pushtoken|token|secret|database64|rawheaders?)/iu;
const BEARER_VALUE_PATTERN = /Bearer\s+[-._~+/=A-Za-z0-9]+/gu;
const EXPO_PUSH_TOKEN_PATTERN = /(?:Expo|Exponent)PushToken\[[^\]]+\]/gu;

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
  let pendingWrite = Promise.resolve();

  return {
    logPath,
    flush() {
      return pendingWrite;
    },
    log(level, event, fields = {}) {
      const entry = {
        timestamp: now().toISOString(),
        level,
        event,
        ...redactDiagnosticsFields(fields)
      };
      const line = `${JSON.stringify(entry)}\n`;
      pendingWrite = pendingWrite
        .then(async () => {
          await mkdir(dirname(logPath), { recursive: true });
          await appendFile(logPath, line, "utf8");
        })
        .catch(() => undefined);
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

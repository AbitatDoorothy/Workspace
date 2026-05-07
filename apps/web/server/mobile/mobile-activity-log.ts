import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface MobileActivityLogOptions {
  filePath?: string;
  logger?: { warn(message: string): void };
  now?: () => Date;
}

export interface MobileActivityLog {
  filePath: string;
  flush(): Promise<void>;
  record(event: string, details?: Record<string, unknown>): void;
}

export function createMobileActivityLog(options: MobileActivityLogOptions = {}): MobileActivityLog {
  const filePath = options.filePath ?? join(process.cwd(), ".data", "mobile-activity.jsonl");
  const now = options.now ?? (() => new Date());
  let writeQueue = Promise.resolve();

  function enqueue(write: () => Promise<void>) {
    writeQueue = writeQueue.then(write, write).catch((error) => {
      options.logger?.warn(
        `[mobile-activity] Failed to write activity log: ${errorMessage(error)}`
      );
    });
  }

  return {
    filePath,

    async flush() {
      await writeQueue;
    },

    record(event, details = {}) {
      const line = `${JSON.stringify({
        timestamp: now().toISOString(),
        event,
        ...normalizeLogDetails(details)
      })}\n`;

      enqueue(async () => {
        await mkdir(dirname(filePath), { recursive: true });
        await appendFile(filePath, line, "utf8");
      });
    }
  };
}

export const mobileActivityLog = createMobileActivityLog({ logger: console });

function normalizeLogDetails(details: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, normalizeLogValue(value)])
  );
}

function normalizeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack
    };
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

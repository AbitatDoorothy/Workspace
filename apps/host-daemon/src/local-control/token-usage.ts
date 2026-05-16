import { createReadStream } from "node:fs";
import { opendir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export type CodexTokenUsageTimeframe = "1d" | "7d" | "all";

export interface CodexTokenUsageBucket {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CodexTokenUsageSummary {
  allTime: CodexTokenUsageBucket;
  generatedAt: string;
  oneDay: CodexTokenUsageBucket;
  sevenDays: CodexTokenUsageBucket;
}

interface ReadCodexTokenUsageOptions {
  codexHome?: string;
  now?: Date;
}

interface RawTokenUsage {
  cached_input_tokens?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

export async function readCodexTokenUsageSummary(
  options: ReadCodexTokenUsageOptions = {}
): Promise<CodexTokenUsageSummary> {
  const now = options.now ?? new Date();
  const cutoffs = {
    oneDay: now.getTime() - ONE_DAY_MS,
    sevenDays: now.getTime() - SEVEN_DAYS_MS
  };
  const summary: CodexTokenUsageSummary = {
    allTime: emptyUsageBucket(),
    generatedAt: now.toISOString(),
    oneDay: emptyUsageBucket(),
    sevenDays: emptyUsageBucket()
  };

  for await (const filePath of codexRolloutFiles(options.codexHome ?? defaultCodexHome())) {
    await addRolloutFileUsage(summary, filePath, cutoffs);
  }

  return summary;
}

async function addRolloutFileUsage(
  summary: CodexTokenUsageSummary,
  filePath: string,
  cutoffs: { oneDay: number; sevenDays: number }
) {
  let previous = emptyUsageBucket();
  const lines = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(filePath, { encoding: "utf8" })
  });

  try {
    for await (const line of lines) {
      const event = parseTokenCountEvent(line);
      if (!event) {
        continue;
      }

      const delta = usageDelta(previous, event.usage);
      previous = event.usage;
      addUsage(summary.allTime, delta);

      if (event.timestampMs >= cutoffs.sevenDays) {
        addUsage(summary.sevenDays, delta);
      }
      if (event.timestampMs >= cutoffs.oneDay) {
        addUsage(summary.oneDay, delta);
      }
    }
  } catch {
    // Codex may rotate or rewrite rollout files while Abitat is reading them.
    // A skipped file is better than breaking the mobile dashboard.
  }
}

async function* codexRolloutFiles(codexHome: string): AsyncGenerator<string> {
  for (const directory of [join(codexHome, "sessions"), join(codexHome, "archived_sessions")]) {
    yield* jsonlFiles(directory);
  }
}

async function* jsonlFiles(directory: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await opendir(directory);
  } catch {
    return;
  }

  for await (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* jsonlFiles(path);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield path;
    }
  }
}

function parseTokenCountEvent(line: string) {
  if (!line.includes('"token_count"')) {
    return null;
  }

  try {
    const parsed = JSON.parse(line) as {
      payload?: { info?: { total_token_usage?: RawTokenUsage }; type?: unknown };
      timestamp?: unknown;
      type?: unknown;
    };

    if (parsed.type !== "event_msg" || parsed.payload?.type !== "token_count") {
      return null;
    }

    const timestampMs =
      typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : Number.NaN;
    const usage = parseUsage(parsed.payload.info?.total_token_usage);
    if (!Number.isFinite(timestampMs) || !usage) {
      return null;
    }

    return { timestampMs, usage };
  } catch {
    return null;
  }
}

function parseUsage(input: RawTokenUsage | undefined): CodexTokenUsageBucket | null {
  if (!input) {
    return null;
  }

  const totalTokens = nonNegativeInteger(input.total_tokens);
  const inputTokens = nonNegativeInteger(input.input_tokens);
  const outputTokens = nonNegativeInteger(input.output_tokens);
  const cachedInputTokens = nonNegativeInteger(input.cached_input_tokens);
  if (
    totalTokens === null ||
    inputTokens === null ||
    outputTokens === null ||
    cachedInputTokens === null
  ) {
    return null;
  }

  return {
    cachedInputTokens,
    inputTokens,
    outputTokens,
    totalTokens
  };
}

function usageDelta(previous: CodexTokenUsageBucket, next: CodexTokenUsageBucket) {
  return {
    cachedInputTokens: positiveDelta(previous.cachedInputTokens, next.cachedInputTokens),
    inputTokens: positiveDelta(previous.inputTokens, next.inputTokens),
    outputTokens: positiveDelta(previous.outputTokens, next.outputTokens),
    totalTokens: positiveDelta(previous.totalTokens, next.totalTokens)
  };
}

function positiveDelta(previous: number, next: number) {
  return next >= previous ? next - previous : next;
}

function addUsage(target: CodexTokenUsageBucket, delta: CodexTokenUsageBucket) {
  target.cachedInputTokens += delta.cachedInputTokens;
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  target.totalTokens += delta.totalTokens;
}

function emptyUsageBucket(): CodexTokenUsageBucket {
  return {
    cachedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function defaultCodexHome() {
  return join(homedir(), ".codex");
}

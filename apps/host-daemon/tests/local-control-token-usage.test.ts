import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { readCodexTokenUsageSummary } from "../src/local-control/token-usage";

describe("local Codex token usage", () => {
  it("aggregates token count deltas for one day, seven days, and all time", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-token-usage-"));
    const sessionsDirectory = join(directory, "sessions", "2026", "05", "15");
    const archivedDirectory = join(directory, "archived_sessions");
    await mkdir(sessionsDirectory, { recursive: true });
    await mkdir(archivedDirectory, { recursive: true });
    await writeFile(
      join(sessionsDirectory, "rollout-recent.jsonl"),
      [
        tokenCountLine("2026-05-15T09:00:00.000Z", {
          cached_input_tokens: 20,
          input_tokens: 100,
          output_tokens: 30,
          reasoning_output_tokens: 5,
          total_tokens: 130
        }),
        tokenCountLine("2026-05-15T10:00:00.000Z", {
          cached_input_tokens: 25,
          input_tokens: 140,
          output_tokens: 50,
          reasoning_output_tokens: 7,
          total_tokens: 190
        })
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(archivedDirectory, "rollout-week.jsonl"),
      [
        tokenCountLine("2026-05-10T12:00:00.000Z", {
          cached_input_tokens: 40,
          input_tokens: 200,
          output_tokens: 80,
          reasoning_output_tokens: 12,
          total_tokens: 280
        })
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(archivedDirectory, "rollout-old.jsonl"),
      [
        tokenCountLine("2026-04-01T12:00:00.000Z", {
          cached_input_tokens: 3,
          input_tokens: 10,
          output_tokens: 5,
          reasoning_output_tokens: 1,
          total_tokens: 15
        })
      ].join("\n"),
      "utf8"
    );

    const summary = await readCodexTokenUsageSummary({
      codexHome: directory,
      now: new Date("2026-05-15T12:00:00.000Z")
    });

    expect(summary.oneDay).toMatchObject({
      cachedInputTokens: 25,
      inputTokens: 140,
      outputTokens: 50,
      totalTokens: 190
    });
    expect(summary.sevenDays).toMatchObject({
      cachedInputTokens: 65,
      inputTokens: 340,
      outputTokens: 130,
      totalTokens: 470
    });
    expect(summary.allTime).toMatchObject({
      cachedInputTokens: 68,
      inputTokens: 350,
      outputTokens: 135,
      totalTokens: 485
    });
  });
});

function tokenCountLine(
  timestamp: string,
  totalTokenUsage: {
    cached_input_tokens: number;
    input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
    total_tokens: number;
  }
) {
  return JSON.stringify({
    payload: {
      info: {
        total_token_usage: totalTokenUsage
      },
      type: "token_count"
    },
    timestamp,
    type: "event_msg"
  });
}

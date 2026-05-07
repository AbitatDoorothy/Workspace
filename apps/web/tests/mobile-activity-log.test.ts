import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createMobileActivityLog } from "../server/mobile/mobile-activity-log";

describe("mobile activity log", () => {
  it("persists structured activity events as json lines", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-mobile-activity-"));
    const filePath = join(directory, "mobile-activity.jsonl");

    try {
      const log = createMobileActivityLog({ filePath });

      log.record("codex_completion_notification_skipped", {
        conversationId: "codex_thread_thread_1",
        reason: "cancelled"
      });
      log.record("codex_completion_notification_sent", {
        conversationId: "codex_thread_thread_1",
        sentCount: 1
      });

      await log.flush();

      const lines = (await readFile(filePath, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines.map((line) => JSON.parse(line))).toEqual([
        expect.objectContaining({
          conversationId: "codex_thread_thread_1",
          event: "codex_completion_notification_skipped",
          reason: "cancelled"
        }),
        expect.objectContaining({
          conversationId: "codex_thread_thread_1",
          event: "codex_completion_notification_sent",
          sentCount: 1
        })
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

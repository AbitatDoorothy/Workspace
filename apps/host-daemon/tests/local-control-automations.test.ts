import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  createCodexAutomation,
  listCodexAutomations,
  updateCodexAutomation
} from "../src/local-control/automations";

describe("local Codex automations", () => {
  it("lists Codex automation TOML files with editable fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "abitat-automations-"));
    try {
      await createCodexAutomation(
        { rootDir: root },
        {
          cwds: ["/Users/reece/Desktop/Abitat_Workspace"],
          executionEnvironment: "local",
          kind: "cron",
          model: "gpt-5",
          name: "Daily Review",
          prompt: "Review yesterday's Codex work.",
          reasoningEffort: "medium",
          rrule: "FREQ=DAILY;INTERVAL=1",
          status: "ACTIVE"
        }
      );

      const automations = await listCodexAutomations({ rootDir: root });

      expect(automations).toEqual([
        expect.objectContaining({
          cwds: ["/Users/reece/Desktop/Abitat_Workspace"],
          executionEnvironment: "local",
          kind: "cron",
          model: "gpt-5",
          name: "Daily Review",
          prompt: "Review yesterday's Codex work.",
          reasoningEffort: "medium",
          rrule: "FREQ=DAILY;INTERVAL=1",
          status: "ACTIVE"
        })
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("updates an existing automation without changing its id", async () => {
    const root = await mkdtemp(join(tmpdir(), "abitat-automations-"));
    try {
      const created = await createCodexAutomation(
        { rootDir: root },
        {
          cwds: ["/Users/reece/Desktop/Abitat_Workspace"],
          executionEnvironment: "local",
          kind: "cron",
          model: "gpt-5",
          name: "Daily Review",
          prompt: "Review yesterday's Codex work.",
          reasoningEffort: "medium",
          rrule: "FREQ=DAILY;INTERVAL=1",
          status: "ACTIVE"
        }
      );

      const updated = await updateCodexAutomation({ rootDir: root }, created.id, {
        cwds: [],
        name: "Paused Review",
        status: "PAUSED"
      });

      expect(updated).toMatchObject({
        cwds: [],
        id: created.id,
        name: "Paused Review",
        status: "PAUSED"
      });
      expect(await readFile(join(root, created.id, "automation.toml"), "utf8")).toContain(
        'status = "PAUSED"'
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves automation fields that are not edited by the mobile app", async () => {
    const root = await mkdtemp(join(tmpdir(), "abitat-automations-"));
    try {
      const automationDir = join(root, "heartbeat-demo");
      await mkdir(automationDir, { recursive: true });
      await writeFile(
        join(automationDir, "automation.toml"),
        [
          "version = 1",
          'id = "heartbeat-demo"',
          'kind = "heartbeat"',
          'name = "Heartbeat Demo"',
          'prompt = "Check back later."',
          'status = "ACTIVE"',
          'rrule = "FREQ=MINUTELY;INTERVAL=30"',
          'model = "gpt-5"',
          'reasoning_effort = "medium"',
          'execution_environment = "local"',
          "cwds = []",
          'destination = "thread"',
          'target_thread_id = "019ec1"',
          "created_at = 1779000000000",
          "updated_at = 1779000000000",
          ""
        ].join("\n"),
        "utf8"
      );

      await updateCodexAutomation(
        { now: () => 1_779_000_000_000, rootDir: root },
        "heartbeat-demo",
        {
          status: "PAUSED"
        }
      );

      const saved = await readFile(join(automationDir, "automation.toml"), "utf8");
      expect(saved).toContain('destination = "thread"');
      expect(saved).toContain('target_thread_id = "019ec1"');
      expect(saved).toContain('status = "PAUSED"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

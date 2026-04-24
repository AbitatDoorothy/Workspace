import { describe, expect, it } from "vitest";

import {
  conversationCreateRequestSchema,
  conversationTypeSchema,
  daemonJobPollResponseSchema,
  runtimeSchema,
  toolScanUploadRequestSchema
} from "../src/index";

describe("shared schema validation", () => {
  it("rejects invalid conversation types", () => {
    expect(conversationTypeSchema.safeParse("maintenance").success).toBe(false);
    expect(
      conversationCreateRequestSchema.safeParse({
        workspaceId: "workspace_123",
        projectId: "project_123",
        agentId: "agent_123",
        type: "maintenance",
        prompt: "Patch dependencies."
      }).success
    ).toBe(false);
  });

  it("rejects invalid runtimes", () => {
    expect(runtimeSchema.safeParse("gpt-999").success).toBe(false);
    expect(
      daemonJobPollResponseSchema.safeParse({
        job: {
          id: "job_123",
          type: "start_conversation",
          conversationId: "conv_123",
          payload: {
            repoUrl: "https://github.com/example/app.git",
            defaultBranch: "main",
            agentRuntime: "gpt-999",
            model: "mock-model",
            instructions: "You are careful.",
            prompt: "Add password reset."
          }
        }
      }).success
    ).toBe(false);
  });

  it("accepts valid host tool scans", () => {
    expect(
      toolScanUploadRequestSchema.parse({
        machineId: "machine_123",
        tools: [
          {
            name: "git",
            installed: true,
            version: "2.45.0",
            path: "/usr/bin/git"
          },
          {
            name: "codex",
            installed: false
          }
        ]
      })
    ).toEqual({
      machineId: "machine_123",
      tools: [
        {
          name: "git",
          installed: true,
          version: "2.45.0",
          path: "/usr/bin/git"
        },
        {
          name: "codex",
          installed: false
        }
      ]
    });
  });
});

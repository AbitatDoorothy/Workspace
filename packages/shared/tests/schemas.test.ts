import { describe, expect, it } from "vitest";

import {
  commitAndPushJobSchema,
  conversationCreateRequestSchema,
  conversationTypeSchema,
  daemonJobAckRequestSchema,
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
            conversationType: "feature",
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

  it("accepts worktree metadata on daemon job acknowledgment", () => {
    expect(
      daemonJobAckRequestSchema.parse({
        status: "running",
        branchName: "abitat/feature/abcdef12-add-a-useful-page",
        worktreePath:
          "/tmp/AbitatWorkspace/worktrees/conversation_abcdef123456-abitat-feature-abcdef12-add-a-useful-page"
      })
    ).toEqual({
      status: "running",
      branchName: "abitat/feature/abcdef12-add-a-useful-page",
      worktreePath:
        "/tmp/AbitatWorkspace/worktrees/conversation_abcdef123456-abitat-feature-abcdef12-add-a-useful-page"
    });
  });

  it("accepts commit and push job metadata", () => {
    expect(
      commitAndPushJobSchema.parse({
        id: "job_123",
        type: "commit_and_push",
        conversationId: "conversation_123",
        payload: {
          commitMessage: "feat: add mock run log",
          branchName: "abitat/feature/abcdef12-add-a-useful-page",
          worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_123"
        }
      })
    ).toMatchObject({
      type: "commit_and_push",
      payload: {
        branchName: "abitat/feature/abcdef12-add-a-useful-page",
        worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_123"
      }
    });
  });

  it("accepts pushed git result metadata on daemon job acknowledgment", () => {
    expect(
      daemonJobAckRequestSchema.parse({
        status: "completed",
        commitSha: "abc123",
        prUrl: "https://github.com/example/app/pull/1",
        errorMessage: "gh is not authenticated"
      })
    ).toEqual({
      status: "completed",
      commitSha: "abc123",
      prUrl: "https://github.com/example/app/pull/1",
      errorMessage: "gh is not authenticated"
    });
  });
});

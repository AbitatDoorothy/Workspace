import { describe, expect, it } from "vitest";

import {
  cloneRepoJobSchema,
  commitAndPushJobSchema,
  conversationCreateRequestSchema,
  conversationTypeSchema,
  daemonJobSchema,
  daemonJobPollRequestSchema,
  daemonJobAckRequestSchema,
  daemonJobPollResponseSchema,
  startConversationJobSchema,
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

  it("accepts blank prompts for terminal-started conversations", () => {
    expect(
      conversationCreateRequestSchema.parse({
        workspaceId: "workspace_123",
        projectId: "project_123",
        agentId: "agent_123",
        type: "feature",
        prompt: ""
      })
    ).toMatchObject({
      prompt: ""
    });

    expect(
      startConversationJobSchema.parse({
        id: "job_start",
        type: "start_conversation",
        conversationId: "conversation_123",
        payload: {
          repoUrl: "/Users/reece/Desktop/Test",
          defaultBranch: "local",
          conversationType: "feature",
          agentRuntime: "codex",
          model: "5.4",
          instructions: "Start Codex in Terminal.",
          prompt: "",
          hostLocalPath: "/Users/reece/Desktop/Test"
        }
      })
    ).toMatchObject({
      payload: {
        prompt: ""
      }
    });
  });

  it("defaults project starts to Codex without an explicit agent or model", () => {
    expect(
      conversationCreateRequestSchema.parse({
        workspaceId: "workspace_123",
        projectId: "project_123"
      })
    ).toMatchObject({
      runtime: "codex",
      type: "investigation",
      prompt: ""
    });

    expect(
      startConversationJobSchema.parse({
        id: "job_start",
        type: "start_conversation",
        conversationId: "conversation_123",
        payload: {
          repoUrl: "/Users/reece/Desktop/Test",
          defaultBranch: "local",
          conversationType: "investigation",
          agentRuntime: "codex",
          instructions: "Start Codex in iTerm2.",
          prompt: "",
          hostLocalPath: "/Users/reece/Desktop/Test"
        }
      })
    ).toMatchObject({
      payload: {
        agentRuntime: "codex"
      }
    });
  });

  it("accepts hidden same-thread conversation summary jobs", () => {
    expect(
      daemonJobSchema.parse({
        id: "job_summary",
        type: "summarize_conversation",
        conversationId: "conversation_123",
        payload: {
          repoUrl: "/Users/reece/Desktop/Test",
          defaultBranch: "local",
          conversationType: "feature",
          agentRuntime: "codex",
          instructions: "Summarize the thread.",
          prompt: "Summarize what has been done.",
          allowedTools: [],
          resumeSessionId: "session_123",
          worktreePath: "/Users/reece/Desktop/Test",
          branchName: "abitat/feature/demo",
          hostLocalPath: "/Users/reece/Desktop/Test",
          presentation: "inline",
          taskTitle: "Demo task"
        }
      })
    ).toMatchObject({
      type: "summarize_conversation",
      payload: {
        presentation: "inline",
        taskTitle: "Demo task"
      }
    });
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

  it("accepts SSH GitHub repo URLs in daemon job payloads", () => {
    expect(
      cloneRepoJobSchema.parse({
        id: "job_clone",
        type: "clone_repo",
        projectId: "project_123",
        payload: {
          repoUrl: "git@github.com:AbitatDoorothy/Workspace.git",
          defaultBranch: "main"
        }
      })
    ).toMatchObject({
      payload: {
        repoUrl: "git@github.com:AbitatDoorothy/Workspace.git"
      }
    });

    expect(
      startConversationJobSchema.parse({
        id: "job_start",
        type: "start_conversation",
        conversationId: "conversation_123",
        payload: {
          repoUrl: "git@github.com:AbitatDoorothy/Workspace.git",
          defaultBranch: "main",
          conversationType: "feature",
          agentRuntime: "codex",
          model: "5.4",
          instructions: "Create the requested file.",
          prompt: "Create success.md.",
          resumeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce",
          worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_123",
          branchName: "abitat/feature/abcdef12-add-success",
          hostLocalPath: "/Users/reece/Desktop/Test"
        }
      })
    ).toMatchObject({
      payload: {
        repoUrl: "git@github.com:AbitatDoorothy/Workspace.git",
        resumeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce",
        worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_123",
        hostLocalPath: "/Users/reece/Desktop/Test"
      }
    });
  });

  it("accepts active conversation metadata when polling daemon jobs", () => {
    expect(
      daemonJobPollRequestSchema.parse({
        machineId: "machine_demo",
        activeConversationId: "conversation_123"
      })
    ).toEqual({
      machineId: "machine_demo",
      activeConversationId: "conversation_123"
    });
  });

  it("accepts multiple active conversation ids when polling daemon jobs", () => {
    expect(
      daemonJobPollRequestSchema.parse({
        machineId: "machine_demo",
        activeConversationIds: ["conversation_123", "conversation_456"]
      })
    ).toEqual({
      machineId: "machine_demo",
      activeConversationIds: ["conversation_123", "conversation_456"]
    });
  });

  it("accepts worktree metadata on daemon job acknowledgment", () => {
    expect(
      daemonJobAckRequestSchema.parse({
        status: "running",
        branchName: "abitat/feature/abcdef12-add-a-useful-page",
        worktreePath:
          "/tmp/AbitatWorkspace/worktrees/conversation_abcdef123456-abitat-feature-abcdef12-add-a-useful-page",
        runtimeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce"
      })
    ).toEqual({
      status: "running",
      branchName: "abitat/feature/abcdef12-add-a-useful-page",
      worktreePath:
        "/tmp/AbitatWorkspace/worktrees/conversation_abcdef123456-abitat-feature-abcdef12-add-a-useful-page",
      runtimeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce"
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

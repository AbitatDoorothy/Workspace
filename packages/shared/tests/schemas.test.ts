import { describe, expect, it } from "vitest";

import {
  cloneRepoJobSchema,
  commitAndPushJobSchema,
  conversationCreateRequestSchema,
  conversationMessageCreateRequestSchema,
  conversationMessageRoleSchema,
  conversationTypeSchema,
  codexMobileModelSettingsSchema,
  codexModelOptionsResponseSchema,
  codexReasoningEffortSchema,
  daemonJobSchema,
  daemonJobPollRequestSchema,
  daemonJobAckRequestSchema,
  daemonJobPollResponseSchema,
  mobileBootstrapResponseSchema,
  phonePairingCompleteRequestSchema,
  phonePairingCompleteResponseSchema,
  phonePairingStartRequestSchema,
  phonePairingStartResponseSchema,
  remoteControlFrameResponseSchema,
  remoteControlInputRequestSchema,
  remoteControlSessionCreateRequestSchema,
  remoteControlSessionResponseSchema,
  remoteControlSignalSchema,
  remoteControlTextTargetResponseSchema,
  remoteInputEventSchema,
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

  it("accepts phone pairing payloads and mobile bootstrap data", () => {
    expect(
      phonePairingStartRequestSchema.parse({
        workspaceId: "workspace_demo",
        hostMachineId: "machine_demo"
      })
    ).toEqual({
      workspaceId: "workspace_demo",
      hostMachineId: "machine_demo"
    });

    expect(
      phonePairingStartResponseSchema.parse({
        pairingId: "pairing_123",
        code: "ABITAT-123456",
        expiresAt: "2026-05-03T12:00:00.000Z",
        qrPayload: "abitat://pair?code=ABITAT-123456"
      })
    ).toMatchObject({
      code: "ABITAT-123456"
    });

    expect(
      phonePairingCompleteRequestSchema.parse({
        code: "ABITAT-123456",
        deviceName: "Reece iPhone",
        platform: "ios",
        appVersion: "1.0.0",
        publicKey: "phone-public-key"
      })
    ).toMatchObject({
      platform: "ios"
    });

    expect(
      phonePairingCompleteResponseSchema.parse({
        machineId: "machine_phone",
        workspaceId: "workspace_demo",
        hostMachineId: "machine_demo",
        clientToken: "client_secret"
      })
    ).toMatchObject({
      machineId: "machine_phone",
      hostMachineId: "machine_demo"
    });

    expect(
      mobileBootstrapResponseSchema.parse({
        workspace: { id: "workspace_demo", name: "Demo Workspace" },
        phone: { id: "machine_phone", name: "Reece iPhone", status: "online" },
        host: { id: "machine_demo", name: "Demo Host", status: "online" }
      })
    ).toMatchObject({
      workspace: { id: "workspace_demo" }
    });
  });

  it("accepts synced conversation messages", () => {
    expect(conversationMessageRoleSchema.safeParse("assistant").success).toBe(true);
    expect(conversationMessageRoleSchema.safeParse("operator").success).toBe(false);

    expect(
      conversationMessageCreateRequestSchema.parse({
        content: "Continue the Codex task.",
        role: "user",
        sourceDeviceId: "machine_phone",
        clientMessageId: "local-message-1"
      })
    ).toEqual({
      content: "Continue the Codex task.",
      role: "user",
      sourceDeviceId: "machine_phone",
      clientMessageId: "local-message-1",
      metadata: {}
    });
  });

  it("validates Codex mobile model settings and dynamic model options", () => {
    expect(codexReasoningEffortSchema.safeParse("xhigh").success).toBe(true);
    expect(codexReasoningEffortSchema.safeParse("extreme").success).toBe(false);

    expect(
      codexMobileModelSettingsSchema.parse({
        model: "gpt-5.3-codex",
        effort: "high"
      })
    ).toEqual({
      model: "gpt-5.3-codex",
      effort: "high"
    });

    expect(codexMobileModelSettingsSchema.safeParse({ model: "", effort: "high" }).success).toBe(
      false
    );
    expect(
      codexMobileModelSettingsSchema.safeParse({ model: "gpt-5.3-codex", effort: "extreme" })
        .success
    ).toBe(false);

    expect(
      codexModelOptionsResponseSchema.parse({
        models: [
          {
            id: "gpt-5.3-codex",
            displayName: "GPT-5.3 Codex",
            description: "Best for agentic coding.",
            supportedReasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"],
            defaultReasoningEffort: "medium",
            isDefault: true
          }
        ]
      })
    ).toEqual({
      models: [
        {
          id: "gpt-5.3-codex",
          displayName: "GPT-5.3 Codex",
          description: "Best for agentic coding.",
          supportedReasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"],
          defaultReasoningEffort: "medium",
          isDefault: true
        }
      ]
    });
  });

  it("accepts remote control session, signaling, and input payloads", () => {
    expect(
      remoteControlSessionCreateRequestSchema.parse({
        hostMachineId: "machine_demo",
        screenEnabled: true,
        inputEnabled: true
      })
    ).toEqual({
      hostMachineId: "machine_demo",
      screenEnabled: true,
      inputEnabled: true
    });

    expect(
      remoteControlSessionResponseSchema.parse({
        id: "remote_123",
        status: "requested",
        hostMachineId: "machine_demo",
        clientMachineId: "machine_phone",
        screenEnabled: true,
        inputEnabled: true
      })
    ).toMatchObject({
      status: "requested"
    });

    expect(
      remoteControlSignalSchema.parse({
        sessionId: "remote_123",
        senderMachineId: "machine_phone",
        recipientMachineId: "machine_demo",
        type: "offer",
        payload: { sdp: "v=0" }
      })
    ).toMatchObject({
      type: "offer"
    });

    expect(
      remoteInputEventSchema.parse({
        type: "pointer",
        phase: "move",
        x: 0.45,
        y: 0.25,
        dx: 12,
        dy: -6
      })
    ).toMatchObject({
      type: "pointer",
      phase: "move"
    });

    expect(
      remoteInputEventSchema.parse({
        type: "key",
        key: "Enter",
        modifiers: ["cmd"]
      })
    ).toMatchObject({
      type: "key",
      modifiers: ["cmd"]
    });
  });

  it("accepts local remote-control frame and input endpoint payloads", () => {
    expect(
      remoteControlSessionResponseSchema.parse({
        id: "remote_demo",
        status: "active",
        hostMachineId: "mac_demo",
        clientMachineId: "phone_demo",
        screenEnabled: true,
        inputEnabled: true,
        permissionState: {
          accessibility: "unknown",
          screenRecording: "granted"
        },
        cursorPosition: {
          x: 0.4,
          y: 0.6
        },
        createdAt: "2026-05-18T09:00:00.000Z",
        updatedAt: "2026-05-18T09:00:01.000Z"
      })
    ).toMatchObject({
      createdAt: "2026-05-18T09:00:00.000Z",
      id: "remote_demo",
      permissionState: {
        screenRecording: "granted"
      },
      cursorPosition: {
        x: 0.4,
        y: 0.6
      },
      updatedAt: "2026-05-18T09:00:01.000Z"
    });

    expect(
      remoteControlFrameResponseSchema.parse({
        frame: {
          capturedAt: "2026-05-18T09:00:02.000Z",
          dataBase64: "aGVsbG8=",
          height: 720,
          mimeType: "image/jpeg",
          sequence: 2,
          width: 1170
        },
        session: {
          id: "remote_demo",
          status: "active",
          hostMachineId: "mac_demo",
          clientMachineId: "phone_demo",
          screenEnabled: true,
          inputEnabled: true,
          createdAt: "2026-05-18T09:00:00.000Z",
          updatedAt: "2026-05-18T09:00:02.000Z"
        }
      }).frame
    ).toMatchObject({
      sequence: 2,
      mimeType: "image/jpeg"
    });

    expect(
      remoteControlInputRequestSchema.parse({
        event: {
          phase: "up",
          type: "pointer",
          x: 0.25,
          y: 0.75
        }
      })
    ).toEqual({
      event: {
        phase: "up",
        type: "pointer",
        x: 0.25,
        y: 0.75
      }
    });

    expect(
      remoteControlTextTargetResponseSchema.parse({
        target: {
          appName: "Notes",
          isTextInput: true,
          role: "AXTextArea",
          roleDescription: "text area"
        }
      })
    ).toEqual({
      target: {
        appName: "Notes",
        isTextInput: true,
        role: "AXTextArea",
        roleDescription: "text area"
      }
    });

    expect(
      remoteControlTextTargetResponseSchema.parse({
        target: null
      })
    ).toEqual({ target: null });

    expect(() =>
      remoteControlTextTargetResponseSchema.parse({
        target: {
          appName: "Notes",
          isTextInput: true,
          role: "AXTextArea",
          value: "do not expose existing field contents"
        }
      })
    ).toThrow();
  });
});

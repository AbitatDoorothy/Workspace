import { describe, expect, it } from "vitest";

import {
  createCodexCompletionNotifier,
  type CodexCompletionState
} from "../server/mobile/codex-completion-notifier";
import {
  createExpoPushTransport,
  createMobilePushService,
  type MobilePushTransport
} from "../server/mobile/mobile-push-service";

describe("mobile push service", () => {
  it("sends Codex completion pushes through registered Expo tokens", async () => {
    const activityEvents: Array<{ details?: Record<string, unknown>; event: string }> = [];
    const sent: unknown[][] = [];
    const transport: MobilePushTransport = {
      send: async (messages) => {
        sent.push(messages);
      }
    };
    const service = createMobilePushService(
      {
        listPushSubscriptionsForHost: async () => [
          {
            machineId: "machine_phone",
            platform: "ios",
            provider: "expo",
            token: "ExpoPushToken[test-token]"
          }
        ]
      },
      {
        activityLog: {
          record: (event, details) => {
            activityEvents.push({ details, event });
          }
        },
        transport
      }
    );

    await expect(
      service.sendCodexThreadDone({
        conversationId: "codex_thread_thread_1",
        failed: false,
        hostMachineId: "machine_demo",
        projectId: "codex_project_project_1",
        projectName: "Abitat_Workspace",
        prompt: "Fix the notifications",
        source: "codex_app",
        turnId: "turn_1",
        workspaceId: "workspace_demo"
      })
    ).resolves.toBe(1);

    expect(sent).toEqual([
      [
        expect.objectContaining({
          body: "Project: Abitat_Workspace",
          data: expect.objectContaining({
            conversationId: "codex_thread_thread_1",
            projectId: "codex_project_project_1",
            source: "codex_app",
            turnId: "turn_1"
          }),
          interruptionLevel: "time-sensitive",
          priority: "high",
          sound: expect.stringMatching(/^codex-done-[123]\.wav$/u),
          title: "Codex thread done",
          to: "ExpoPushToken[test-token]"
        })
      ]
    ]);
    expect(activityEvents).toEqual(
      expect.arrayContaining([
        {
          details: expect.objectContaining({
            conversationId: "codex_thread_thread_1",
            expoSubscriptionCount: 1,
            hostMachineId: "machine_demo",
            subscriptionCount: 1,
            turnId: "turn_1",
            workspaceId: "workspace_demo"
          }),
          event: "mobile_push_subscriptions_loaded"
        },
        {
          details: expect.objectContaining({
            conversationId: "codex_thread_thread_1",
            messageCount: 1,
            turnId: "turn_1"
          }),
          event: "mobile_push_notification_sent"
        }
      ])
    );
  });

  it("records when a Codex completion push has no registered phone subscriptions", async () => {
    const activityEvents: Array<{ details?: Record<string, unknown>; event: string }> = [];
    const service = createMobilePushService(
      {
        listPushSubscriptionsForHost: async () => []
      },
      {
        activityLog: {
          record: (event, details) => {
            activityEvents.push({ details, event });
          }
        }
      }
    );

    await expect(
      service.sendCodexThreadDone({
        conversationId: "codex_thread_thread_1",
        failed: false,
        hostMachineId: "machine_demo",
        projectId: "codex_project_project_1",
        projectName: "Abitat_Workspace",
        prompt: "Fix the notifications",
        source: "codex_app",
        turnId: "turn_1",
        workspaceId: "workspace_demo"
      })
    ).resolves.toBe(0);

    expect(activityEvents).toEqual(
      expect.arrayContaining([
        {
          details: expect.objectContaining({
            conversationId: "codex_thread_thread_1",
            reason: "no_expo_subscriptions",
            turnId: "turn_1"
          }),
          event: "mobile_push_notification_skipped"
        }
      ])
    );
  });

  it("uses a bundled custom iOS sound for Codex completion pushes", async () => {
    const sent: unknown[][] = [];
    const service = createMobilePushService(
      {
        listPushSubscriptionsForHost: async () => [
          {
            machineId: "machine_phone",
            platform: "ios",
            provider: "expo",
            token: "ExpoPushToken[test-token]"
          }
        ]
      },
      {
        soundPicker: () => "codex-done-2.wav",
        transport: {
          send: async (messages) => {
            sent.push(messages);
          }
        }
      }
    );

    await service.sendCodexThreadDone({
      conversationId: "codex_thread_thread_1",
      failed: false,
      hostMachineId: "machine_demo",
      projectId: "codex_project_project_1",
      projectName: "Abitat_Workspace",
      prompt: "Fix the notifications",
      source: "codex_app",
      turnId: "turn_1",
      workspaceId: "workspace_demo"
    });

    expect(sent[0]?.[0]).toEqual(
      expect.objectContaining({
        sound: "codex-done-2.wav"
      })
    );
  });

  it("rejects Expo push ticket errors returned in successful HTTP responses", async () => {
    const transport = createExpoPushTransport(async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              details: { error: "InvalidCredentials" },
              message: "The Apple push notification credentials are invalid.",
              status: "error"
            }
          ]
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200
        }
      );
    });

    await expect(
      transport.send([
        {
          body: "Project: Abitat_Workspace",
          data: expect.objectContaining({
            conversationId: "codex_thread_thread_1",
            projectId: "codex_project_project_1",
            source: "codex_app",
            turnId: "turn_1"
          }),
          interruptionLevel: "time-sensitive",
          priority: "high",
          sound: "codex-done-1.wav",
          title: "Codex thread done",
          to: "ExpoPushToken[test-token]"
        }
      ])
    ).rejects.toThrow("InvalidCredentials");
  });

  it("notifies only when a Codex turn finishes and dedupes repeated polls", async () => {
    const pushed: string[] = [];
    let states: CodexCompletionState[] = [
      completionState({
        latestTurnCompletedAt: null,
        latestTurnId: "turn_1",
        status: "running"
      })
    ];
    const notifier = createCodexCompletionNotifier({
      codexAppService: {
        listCompletionStates: async () => states
      },
      hostMachineId: "machine_demo",
      mobilePushService: {
        sendCodexThreadDone: async (input) => {
          pushed.push(`${input.conversationId}:${input.turnId}`);
          return 1;
        }
      },
      now: () => new Date("2026-05-05T12:00:00.000Z")
    });

    await notifier.pollOnce();
    states = [
      completionState({
        latestTurnCompletedAt: null,
        latestTurnId: "turn_1",
        status: "running",
        updatedAt: "2026-05-05T12:00:05.000Z"
      })
    ];
    await notifier.pollOnce();
    states = [
      completionState({
        latestTurnCompletedAt: "2026-05-05T12:00:08.000Z",
        latestTurnId: "turn_1",
        status: "approved",
        updatedAt: "2026-05-05T12:00:08.000Z"
      })
    ];
    await notifier.pollOnce();
    await notifier.pollOnce();

    expect(pushed).toEqual(["codex_thread_thread_1:turn_1"]);
  });

  it("notifies on bootstrap when a turn completed after the notifier started", async () => {
    const pushed: string[] = [];
    const notifier = createCodexCompletionNotifier({
      codexAppService: {
        listCompletionStates: async () => [
          completionState({
            latestTurnCompletedAt: "2026-05-05T12:00:02.000Z",
            latestTurnId: "turn_1",
            status: "approved",
            updatedAt: "2026-05-05T12:00:02.000Z"
          })
        ]
      },
      hostMachineId: "machine_demo",
      mobilePushService: {
        sendCodexThreadDone: async (input) => {
          pushed.push(`${input.conversationId}:${input.turnId}`);
          return 1;
        }
      },
      now: () => new Date("2026-05-05T12:00:00.000Z")
    });

    await notifier.pollOnce();
    await notifier.pollOnce();

    expect(pushed).toEqual(["codex_thread_thread_1:turn_1"]);
  });

  it("uses the demo host when the configured notifier host is blank", async () => {
    const pushedHosts: string[] = [];
    const notifier = createCodexCompletionNotifier({
      codexAppService: {
        listCompletionStates: async () => [
          completionState({
            latestTurnCompletedAt: "2026-05-05T12:00:02.000Z",
            latestTurnId: "turn_1",
            status: "approved",
            updatedAt: "2026-05-05T12:00:02.000Z"
          })
        ]
      },
      hostMachineId: "",
      mobilePushService: {
        sendCodexThreadDone: async (input) => {
          pushedHosts.push(input.hostMachineId);
          return 1;
        }
      },
      now: () => new Date("2026-05-05T12:00:00.000Z")
    });

    await notifier.pollOnce();

    expect(pushedHosts).toEqual(["machine_demo"]);
  });

  it("retries a completed Codex turn when no push subscription was available yet", async () => {
    const pushed: Array<{ attempt: number; turnId: string }> = [];
    let attempt = 0;
    const notifier = createCodexCompletionNotifier({
      codexAppService: {
        listCompletionStates: async () => [
          completionState({
            latestTurnCompletedAt: "2026-05-05T12:00:02.000Z",
            latestTurnId: "turn_1",
            status: "approved",
            updatedAt: "2026-05-05T12:00:02.000Z"
          })
        ]
      },
      hostMachineId: "machine_demo",
      mobilePushService: {
        sendCodexThreadDone: async (input) => {
          attempt += 1;
          pushed.push({ attempt, turnId: input.turnId });
          return attempt === 1 ? 0 : 1;
        }
      },
      now: () => new Date("2026-05-05T12:00:00.000Z")
    });

    await notifier.pollOnce();
    await notifier.pollOnce();
    await notifier.pollOnce();

    expect(pushed).toEqual([
      { attempt: 1, turnId: "turn_1" },
      { attempt: 2, turnId: "turn_1" }
    ]);
  });

  it("does not send a failed push for cancelled turns before a new Mac-started turn finishes", async () => {
    const activityEvents: Array<{ details?: Record<string, unknown>; event: string }> = [];
    const pushed: Array<{ failed: boolean; status: string; turnId: string }> = [];
    let states: CodexCompletionState[] = [
      completionState({
        isComplete: false,
        latestTurnCompletedAt: null,
        latestTurnId: "turn_cancelled",
        status: "running",
        updatedAt: "2026-05-05T12:00:01.000Z"
      })
    ];
    const notifier = createCodexCompletionNotifier({
      codexAppService: {
        listCompletionStates: async () => states
      },
      hostMachineId: "machine_demo",
      activityLog: {
        record: (event, details) => {
          activityEvents.push({ details, event });
        }
      },
      mobilePushService: {
        sendCodexThreadDone: async (input) => {
          const state = states.find((candidate) => candidate.latestTurnId === input.turnId);
          pushed.push({
            failed: input.failed,
            status: state?.status ?? "unknown",
            turnId: input.turnId
          });
          return 1;
        }
      },
      now: () => new Date("2026-05-05T12:00:00.000Z")
    });

    await notifier.pollOnce();
    states = [
      completionState({
        failed: true,
        isComplete: true,
        latestTurnCompletedAt: "2026-05-05T12:00:04.000Z",
        latestTurnId: "turn_cancelled",
        status: "cancelled",
        updatedAt: "2026-05-05T12:00:04.000Z"
      })
    ];
    await notifier.pollOnce();
    states = [
      completionState({
        isComplete: false,
        latestTurnCompletedAt: null,
        latestTurnId: "turn_done",
        status: "running",
        updatedAt: "2026-05-05T12:00:06.000Z"
      })
    ];
    await notifier.pollOnce();
    states = [
      completionState({
        failed: false,
        isComplete: true,
        latestTurnCompletedAt: "2026-05-05T12:00:12.000Z",
        latestTurnId: "turn_done",
        status: "approved",
        updatedAt: "2026-05-05T12:00:12.000Z"
      })
    ];
    await notifier.pollOnce();

    expect(pushed).toEqual([{ failed: false, status: "approved", turnId: "turn_done" }]);
    expect(activityEvents).toEqual(
      expect.arrayContaining([
        {
          details: expect.objectContaining({
            conversationId: "codex_thread_thread_1",
            reason: "cancelled",
            turnId: "turn_cancelled"
          }),
          event: "codex_completion_notification_skipped"
        },
        {
          details: expect.objectContaining({
            conversationId: "codex_thread_thread_1",
            sentCount: 1,
            turnId: "turn_done"
          }),
          event: "codex_completion_notification_sent"
        }
      ])
    );
  });
});

function completionState(input: Partial<CodexCompletionState> = {}): CodexCompletionState {
  return {
    conversationId: "codex_thread_thread_1",
    failed: input.failed ?? false,
    isComplete: input.isComplete ?? Boolean(input.latestTurnCompletedAt),
    latestTurnCompletedAt: input.latestTurnCompletedAt ?? null,
    latestTurnId: input.latestTurnId ?? "turn_1",
    projectId: "codex_project_project_1",
    projectName: "Abitat_Workspace",
    prompt: "Fix notifications",
    source: "codex_app",
    status: input.status ?? "approved",
    updatedAt: input.updatedAt ?? "2026-05-05T12:00:00.000Z",
    workspaceId: "workspace_demo"
  };
}

import { describe, expect, it } from "vitest";

import {
  createLocalCodexCompletionNotifier,
  createLocalMobilePushService,
  type LocalPushSubscription
} from "../src/local-control/push-notifications";
import type { MobileControlDiagnosticsLogger } from "../src/local-control/diagnostics-log";
import type { LocalCodexCompletionState } from "../src/local-control/server";

describe("local push notifications", () => {
  it("sends one Expo push notification when a Codex turn completes", async () => {
    const sent: unknown[][] = [];
    const subscriptions: LocalPushSubscription[] = [
      {
        deviceId: "phone_test",
        lastSeenAt: "2026-05-10T12:00:00.000Z",
        platform: "ios",
        provider: "expo",
        registeredAt: "2026-05-10T12:00:00.000Z",
        token: "ExponentPushToken[demo]"
      }
    ];
    const diagnostics = createMemoryDiagnostics();
    const states: LocalCodexCompletionState[][] = [
      [
        completionState({
          isComplete: false,
          latestTurnId: "turn_1",
          status: "running",
          updatedAt: "2026-05-10T12:00:00.000Z"
        })
      ],
      [
        completionState({
          isComplete: true,
          latestTurnCompletedAt: "2026-05-10T12:01:00.000Z",
          latestTurnId: "turn_1",
          status: "approved",
          updatedAt: "2026-05-10T12:01:00.000Z"
        })
      ],
      [
        completionState({
          isComplete: true,
          latestTurnCompletedAt: "2026-05-10T12:01:00.000Z",
          latestTurnId: "turn_1",
          status: "approved",
          updatedAt: "2026-05-10T12:01:00.000Z"
        })
      ]
    ];
    const pushService = createLocalMobilePushService(
      {
        listPushSubscriptions: async () => subscriptions
      },
      {
        diagnostics,
        soundPicker: () => "codex-done-2.wav",
        transport: {
          async send(messages) {
            sent.push(messages);
          }
        }
      }
    );
    const notifier = createLocalCodexCompletionNotifier({
      codex: {
        async listCompletionStates() {
          return states.shift() ?? [];
        }
      },
      diagnostics,
      mobilePushService: pushService,
      now: () => new Date("2026-05-10T12:00:30.000Z")
    });

    await notifier.pollOnce();
    await notifier.pollOnce();
    await notifier.pollOnce();

    expect(sent).toEqual([
      [
        expect.objectContaining({
          body: "Project: Demo",
          data: expect.objectContaining({
            conversationId: "codex_thread_demo",
            projectId: "codex_project_demo",
            sound: "codex-done-2.wav",
            source: "codex_app",
            status: "approved",
            turnId: "turn_1",
            workspaceId: "local"
          }),
          interruptionLevel: "time-sensitive",
          priority: "high",
          sound: "codex-done-2.wav",
          title: "Codex thread done",
          to: "ExponentPushToken[demo]"
        })
      ]
    ]);
    expect(diagnostics.events).toContainEqual(
      expect.objectContaining({
        conversationId: "codex_thread_demo",
        event: "completion.poll.result",
        stateCount: 1
      })
    );
    expect(diagnostics.events).toContainEqual(
      expect.objectContaining({
        conversationId: "codex_thread_demo",
        event: "push.send.success",
        sentCount: 1
      })
    );
    expect(JSON.stringify(diagnostics.events)).not.toContain("ExponentPushToken[demo]");
    expect(JSON.stringify(diagnostics.events)).not.toContain("Fix notifications");
  });

  it("sends only one notification per Expo token when duplicate subscriptions exist", async () => {
    const sent: unknown[][] = [];
    const diagnostics = createMemoryDiagnostics();
    const pushService = createLocalMobilePushService(
      {
        listPushSubscriptions: async () => [
          {
            deviceId: "phone_first",
            id: "push_first",
            lastSeenAt: "2026-05-10T12:00:00.000Z",
            platform: "ios",
            provider: "expo",
            registeredAt: "2026-05-10T12:00:00.000Z",
            token: "ExponentPushToken[duplicate]"
          },
          {
            deviceId: "phone_second",
            id: "push_second",
            lastSeenAt: "2026-05-10T12:01:00.000Z",
            platform: "ios",
            provider: "expo",
            registeredAt: "2026-05-10T12:01:00.000Z",
            token: "ExponentPushToken[duplicate]"
          },
          {
            deviceId: "phone_third",
            id: "push_third",
            lastSeenAt: "2026-05-10T12:02:00.000Z",
            platform: "ios",
            provider: "expo",
            registeredAt: "2026-05-10T12:02:00.000Z",
            token: "ExponentPushToken[other]"
          }
        ]
      },
      {
        diagnostics,
        soundPicker: () => "codex-done-1.wav",
        transport: {
          async send(messages) {
            sent.push(messages);
          }
        }
      }
    );

    await expect(
      pushService.sendCodexThreadDone({
        conversationId: "codex_thread_demo",
        failed: false,
        projectId: "codex_project_demo",
        projectName: "Demo",
        prompt: "Fix notifications",
        source: "codex_app",
        status: "approved",
        turnId: "turn_1",
        workspaceId: "local"
      })
    ).resolves.toBe(2);

    expect(sent).toEqual([
      [
        expect.objectContaining({ to: "ExponentPushToken[duplicate]" }),
        expect.objectContaining({ to: "ExponentPushToken[other]" })
      ]
    ]);
    expect(diagnostics.events).toContainEqual(
      expect.objectContaining({
        duplicateSubscriptionCount: 1,
        event: "push.send.success",
        sentCount: 2,
        subscriptionCount: 3
      })
    );
    expect(JSON.stringify(diagnostics.events)).not.toContain("ExponentPushToken[duplicate]");
    expect(JSON.stringify(diagnostics.events)).not.toContain("ExponentPushToken[other]");
  });

  it("does not resend a completed turn when its completion timestamp changes", async () => {
    const pushed: string[] = [];
    let states: LocalCodexCompletionState[] = [
      completionState({
        isComplete: false,
        latestTurnId: "turn_1",
        status: "running",
        updatedAt: "2026-05-10T12:00:00.000Z"
      })
    ];
    const notifier = createLocalCodexCompletionNotifier({
      codex: {
        async listCompletionStates() {
          return states;
        }
      },
      mobilePushService: {
        async sendCodexThreadDone(input) {
          pushed.push(`${input.conversationId}:${input.turnId}`);
          return 1;
        }
      },
      now: () => new Date("2026-05-10T12:00:30.000Z")
    });

    await notifier.pollOnce();
    states = [
      completionState({
        isComplete: true,
        latestTurnCompletedAt: "2026-05-10T12:01:00.000Z",
        latestTurnId: "turn_1",
        status: "approved",
        updatedAt: "2026-05-10T12:01:00.000Z"
      })
    ];
    await notifier.pollOnce();
    states = [
      completionState({
        isComplete: true,
        latestTurnCompletedAt: "2026-05-10T12:02:00.000Z",
        latestTurnId: "turn_1",
        status: "approved",
        updatedAt: "2026-05-10T12:02:00.000Z"
      })
    ];
    await notifier.pollOnce();

    expect(pushed).toEqual(["codex_thread_demo:turn_1"]);
  });

  it("does not send notifications for turns completed before the notifier starts", async () => {
    const sent: unknown[][] = [];
    const notifier = createLocalCodexCompletionNotifier({
      codex: {
        async listCompletionStates() {
          return [
            completionState({
              isComplete: true,
              latestTurnCompletedAt: "2026-05-10T11:59:00.000Z",
              latestTurnId: "turn_old",
              status: "approved",
              updatedAt: "2026-05-10T11:59:00.000Z"
            })
          ];
        }
      },
      mobilePushService: createLocalMobilePushService(
        {
          listPushSubscriptions: async () => [
            {
              deviceId: "phone_test",
              lastSeenAt: "2026-05-10T12:00:00.000Z",
              platform: "ios",
              provider: "expo",
              registeredAt: "2026-05-10T12:00:00.000Z",
              token: "ExponentPushToken[demo]"
            }
          ]
        },
        {
          transport: {
            async send(messages) {
              sent.push(messages);
            }
          }
        }
      ),
      now: () => new Date("2026-05-10T12:00:30.000Z")
    });

    await notifier.pollOnce();
    await notifier.pollOnce();

    expect(sent).toEqual([]);
  });

  it("logs push notification failures without push tokens or prompt text", async () => {
    const diagnostics = createMemoryDiagnostics();
    const pushService = createLocalMobilePushService(
      {
        listPushSubscriptions: async () => [
          {
            deviceId: "phone_test",
            lastSeenAt: "2026-05-10T12:00:00.000Z",
            platform: "ios",
            provider: "expo",
            registeredAt: "2026-05-10T12:00:00.000Z",
            token: "ExponentPushToken[demo]"
          }
        ]
      },
      {
        diagnostics,
        transport: {
          async send() {
            throw new Error("Expo rejected the request");
          }
        }
      }
    );

    await expect(
      pushService.sendCodexThreadDone({
        conversationId: "codex_thread_demo",
        failed: false,
        projectId: "codex_project_demo",
        projectName: "Demo",
        prompt: "Sensitive prompt text",
        source: "codex_app",
        status: "approved",
        turnId: "turn_1",
        workspaceId: "local"
      })
    ).rejects.toThrow("Expo rejected the request");

    expect(diagnostics.events).toContainEqual(
      expect.objectContaining({
        conversationId: "codex_thread_demo",
        error: "Expo rejected the request",
        event: "push.send.failure"
      })
    );
    expect(JSON.stringify(diagnostics.events)).not.toContain("ExponentPushToken[demo]");
    expect(JSON.stringify(diagnostics.events)).not.toContain("Sensitive prompt text");
  });
});

function completionState(
  input: Partial<LocalCodexCompletionState> = {}
): LocalCodexCompletionState {
  return {
    conversationId: "codex_thread_demo",
    failed: input.failed ?? false,
    isComplete: input.isComplete ?? false,
    latestTurnCompletedAt: input.latestTurnCompletedAt ?? null,
    latestTurnId: input.latestTurnId ?? null,
    projectId: "codex_project_demo",
    projectName: "Demo",
    prompt: "Fix notifications",
    source: "codex_app",
    status: input.status ?? "running",
    updatedAt: input.updatedAt ?? "2026-05-10T12:00:00.000Z",
    workspaceId: "local"
  };
}

function createMemoryDiagnostics() {
  const events: Array<Record<string, unknown>> = [];
  const logger: MobileControlDiagnosticsLogger & { events: Array<Record<string, unknown>> } = {
    events,
    log(level, event, fields = {}) {
      events.push({ event, level, ...fields });
    }
  };

  return logger;
}

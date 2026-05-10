import { describe, expect, it } from "vitest";

import {
  createLocalCodexCompletionNotifier,
  createLocalMobilePushService,
  type LocalPushSubscription
} from "../src/local-control/push-notifications";
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

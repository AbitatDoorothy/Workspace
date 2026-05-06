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
      { transport }
    );

    await expect(
      service.sendCodexThreadDone({
        conversationId: "codex_thread_thread_1",
        failed: false,
        hostMachineId: "machine_demo",
        projectId: "codex_project_project_1",
        prompt: "Fix the notifications",
        source: "codex_app",
        turnId: "turn_1",
        workspaceId: "workspace_demo"
      })
    ).resolves.toBe(1);

    expect(sent).toEqual([
      [
        expect.objectContaining({
          body: "Fix the notifications",
          data: {
            conversationId: "codex_thread_thread_1",
            projectId: "codex_project_project_1",
            source: "codex_app",
            turnId: "turn_1"
          },
          sound: "default",
          title: "Codex thread done",
          to: "ExpoPushToken[test-token]"
        })
      ]
    ]);
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
          body: "Fix notifications",
          data: {
            conversationId: "codex_thread_thread_1",
            projectId: "codex_project_project_1",
            source: "codex_app",
            turnId: "turn_1"
          },
          sound: "default",
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
});

function completionState(input: Partial<CodexCompletionState> = {}): CodexCompletionState {
  return {
    conversationId: "codex_thread_thread_1",
    failed: false,
    isComplete: Boolean(input.latestTurnCompletedAt),
    latestTurnCompletedAt: input.latestTurnCompletedAt ?? null,
    latestTurnId: input.latestTurnId ?? "turn_1",
    projectId: "codex_project_project_1",
    prompt: "Fix notifications",
    source: "codex_app",
    status: input.status ?? "approved",
    updatedAt: input.updatedAt ?? "2026-05-05T12:00:00.000Z",
    workspaceId: "workspace_demo"
  };
}

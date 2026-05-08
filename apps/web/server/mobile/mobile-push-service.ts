import type { MobilePushSubscription } from "./mobile-service";
import type { MobileActivityLog } from "./mobile-activity-log";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

interface MobilePushLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface MobilePushMessage {
  body: string;
  data: Record<string, string>;
  interruptionLevel: "time-sensitive";
  priority: "high";
  sound: string;
  title: string;
  to: string;
}

export interface MobilePushTransport {
  send(messages: MobilePushMessage[]): Promise<void>;
}

export const CODEX_COMPLETION_NOTIFICATION_SOUNDS = [
  "codex-done-1.wav",
  "codex-done-2.wav",
  "codex-done-3.wav"
] as const;

interface MobilePushServiceMobileService {
  listPushSubscriptionsForHost(input: {
    hostMachineId: string;
    workspaceId: string;
  }): Promise<MobilePushSubscription[]>;
}

interface SendCodexThreadDoneInput {
  conversationId: string;
  failed: boolean;
  hostMachineId: string;
  projectId: string;
  projectName: string;
  prompt: string;
  source: "codex_app";
  turnId: string;
  workspaceId: string;
}

export function createMobilePushService(
  mobileService: MobilePushServiceMobileService,
  options: {
    activityLog?: Pick<MobileActivityLog, "record">;
    logger?: MobilePushLogger;
    soundPicker?: () => string;
    transport?: MobilePushTransport;
  } = {}
) {
  const transport = options.transport ?? createExpoPushTransport();
  const logger = options.logger;
  const activityLog = options.activityLog;
  const soundPicker = options.soundPicker ?? randomCodexCompletionSound;

  return {
    async sendCodexThreadDone(input: SendCodexThreadDoneInput) {
      const subscriptions = await mobileService.listPushSubscriptionsForHost({
        hostMachineId: input.hostMachineId,
        workspaceId: input.workspaceId
      });
      activityLog?.record("mobile_push_subscriptions_loaded", {
        conversationId: input.conversationId,
        expoSubscriptionCount: subscriptions.filter(
          (subscription) => subscription.provider === "expo"
        ).length,
        hostMachineId: input.hostMachineId,
        subscriptionCount: subscriptions.length,
        turnId: input.turnId,
        workspaceId: input.workspaceId
      });
      const messages = subscriptions
        .filter((subscription) => subscription.provider === "expo")
        .map((subscription) => {
          const sound = soundPicker();

          return {
            body: `Project: ${input.projectName.trim() || "Unknown project"}`,
            data: {
              conversationId: input.conversationId,
              projectId: input.projectId,
              sound,
              source: input.source,
              turnId: input.turnId
            },
            interruptionLevel: "time-sensitive" as const,
            priority: "high" as const,
            sound,
            title: `Codex thread ${input.failed ? "failed" : "done"}`,
            to: subscription.token
          };
        });

      if (messages.length === 0) {
        activityLog?.record("mobile_push_notification_skipped", {
          conversationId: input.conversationId,
          hostMachineId: input.hostMachineId,
          reason: "no_expo_subscriptions",
          turnId: input.turnId,
          workspaceId: input.workspaceId
        });
        logger?.warn(
          `[mobile-push] No registered Expo push subscriptions for host ${input.hostMachineId} in workspace ${input.workspaceId}. Open the iPhone app once after pairing to register remote notifications.`
        );
        return 0;
      }

      try {
        await transport.send(messages);
      } catch (error) {
        activityLog?.record("mobile_push_notification_failed", {
          conversationId: input.conversationId,
          error: errorMessage(error),
          hostMachineId: input.hostMachineId,
          messageCount: messages.length,
          turnId: input.turnId,
          workspaceId: input.workspaceId
        });
        throw error;
      }

      activityLog?.record("mobile_push_notification_sent", {
        conversationId: input.conversationId,
        failed: input.failed,
        hostMachineId: input.hostMachineId,
        messageCount: messages.length,
        turnId: input.turnId,
        workspaceId: input.workspaceId
      });
      logger?.info(
        `[mobile-push] Sent ${messages.length} Codex completion push notification${
          messages.length === 1 ? "" : "s"
        } for ${input.conversationId}.`
      );
      return messages.length;
    }
  };
}

export function randomCodexCompletionSound(random = Math.random) {
  const index = Math.floor(random() * CODEX_COMPLETION_NOTIFICATION_SOUNDS.length);
  return CODEX_COMPLETION_NOTIFICATION_SOUNDS[
    Math.max(0, Math.min(index, CODEX_COMPLETION_NOTIFICATION_SOUNDS.length - 1))
  ];
}

export function createExpoPushTransport(
  fetchFn: typeof fetch = fetch,
  endpoint = EXPO_PUSH_ENDPOINT
): MobilePushTransport {
  return {
    async send(messages) {
      for (const chunk of chunkMessages(messages, 100)) {
        const response = await fetchFn(endpoint, {
          body: JSON.stringify(chunk),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        });

        if (!response.ok) {
          throw new Error(
            `Expo push failed with HTTP ${response.status}: ${await readResponseText(response)}`
          );
        }

        const ticketErrors = expoPushTicketErrors(await readResponseJson(response));
        if (ticketErrors.length > 0) {
          throw new Error(`Expo push failed: ${ticketErrors.join("; ")}`);
        }
      }
    }
  };
}

async function readResponseJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function readResponseText(response: Response) {
  try {
    return await response.text();
  } catch {
    return "<unreadable response body>";
  }
}

function expoPushTicketErrors(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const data = (payload as { data?: unknown }).data;
  const tickets = Array.isArray(data) ? data : [data];

  return tickets.flatMap((ticket) => {
    if (!ticket || typeof ticket !== "object") {
      return [];
    }

    const candidate = ticket as {
      details?: { error?: unknown };
      message?: unknown;
      status?: unknown;
    };
    if (candidate.status !== "error") {
      return [];
    }

    const errorCode =
      typeof candidate.details?.error === "string" ? candidate.details.error : "Unknown";
    const message = typeof candidate.message === "string" ? candidate.message : "No message";

    return [`${errorCode}: ${message}`];
  });
}

function chunkMessages<T>(messages: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }

  return chunks;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

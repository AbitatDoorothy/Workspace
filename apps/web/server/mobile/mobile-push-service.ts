import type { MobilePushSubscription } from "./mobile-service";

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
  sound: "default";
  title: string;
  to: string;
}

export interface MobilePushTransport {
  send(messages: MobilePushMessage[]): Promise<void>;
}

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
  prompt: string;
  source: "codex_app";
  turnId: string;
  workspaceId: string;
}

export function createMobilePushService(
  mobileService: MobilePushServiceMobileService,
  options: { logger?: MobilePushLogger; transport?: MobilePushTransport } = {}
) {
  const transport = options.transport ?? createExpoPushTransport();
  const logger = options.logger;

  return {
    async sendCodexThreadDone(input: SendCodexThreadDoneInput) {
      const subscriptions = await mobileService.listPushSubscriptionsForHost({
        hostMachineId: input.hostMachineId,
        workspaceId: input.workspaceId
      });
      const messages = subscriptions
        .filter((subscription) => subscription.provider === "expo")
        .map((subscription) => ({
          body: input.prompt.trim() || "Untitled Codex thread",
          data: {
            conversationId: input.conversationId,
            projectId: input.projectId,
            source: input.source,
            turnId: input.turnId
          },
          interruptionLevel: "time-sensitive" as const,
          priority: "high" as const,
          sound: "default" as const,
          title: `Codex thread ${input.failed ? "failed" : "done"}`,
          to: subscription.token
        }));

      if (messages.length === 0) {
        logger?.warn(
          `[mobile-push] No registered Expo push subscriptions for host ${input.hostMachineId} in workspace ${input.workspaceId}. Open the iPhone app once after pairing to register remote notifications.`
        );
        return 0;
      }

      await transport.send(messages);
      logger?.info(
        `[mobile-push] Sent ${messages.length} Codex completion push notification${
          messages.length === 1 ? "" : "s"
        } for ${input.conversationId}.`
      );
      return messages.length;
    }
  };
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

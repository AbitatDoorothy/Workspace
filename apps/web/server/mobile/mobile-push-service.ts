import type { MobilePushSubscription } from "./mobile-service";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

export interface MobilePushMessage {
  body: string;
  data: Record<string, string>;
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
  options: { transport?: MobilePushTransport } = {}
) {
  const transport = options.transport ?? createExpoPushTransport();

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
          sound: "default" as const,
          title: `Codex thread ${input.failed ? "failed" : "done"}`,
          to: subscription.token
        }));

      if (messages.length === 0) {
        return 0;
      }

      await transport.send(messages);
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
          throw new Error(`Expo push failed with HTTP ${response.status}`);
        }
      }
    }
  };
}

function chunkMessages<T>(messages: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }

  return chunks;
}

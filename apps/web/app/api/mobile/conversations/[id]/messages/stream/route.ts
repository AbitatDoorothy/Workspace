import { conversationMessageService } from "../../../../../../../server/conversation-messages";
import { conversationQueueService } from "../../../../../../../server/conversations";
import { requireMobileActor } from "../../../../../../../server/mobile/request-auth";

const encoder = new TextEncoder();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, actor] = await Promise.all([context.params, requireMobileActor(request)]);
    await assertMobileConversation(actor.workspaceId, id);
    const after = Number(new URL(request.url).searchParams.get("afterSequence") ?? "0");
    let lastSequence = Number.isFinite(after) ? after : 0;

    const stream = new ReadableStream({
      async start(controller) {
        const sendMessages = async () => {
          const messages = await conversationMessageService.listMessages(id, {
            afterSequence: lastSequence
          });

          for (const message of messages) {
            lastSequence = message.sequence;
            controller.enqueue(
              encoder.encode(
                `event: message\ndata: ${JSON.stringify(serializeMessage(message))}\n\n`
              )
            );
          }
        };

        await sendMessages();
        const interval = setInterval(() => {
          sendMessages().catch((error) => {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({
                  error: error instanceof Error ? error.message : "Unable to stream messages"
                })}\n\n`
              )
            );
          });
        }, 1500);

        request.signal.addEventListener("abort", () => {
          clearInterval(interval);
          controller.close();
        });
      }
    });

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream"
      }
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to stream mobile messages" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

async function assertMobileConversation(workspaceId: string, conversationId: string) {
  const conversation = (await conversationQueueService.listConversations(workspaceId)).find(
    (candidate) => candidate.id === conversationId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }
}

function serializeMessage(message: {
  id: string;
  conversationId: string;
  sequence: number;
  role: string;
  sourceDeviceId?: string | null;
  content: string;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
}) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    sequence: message.sequence,
    role: message.role,
    sourceDeviceId: message.sourceDeviceId ?? null,
    content: message.content,
    metadata: message.metadataJson,
    createdAt: message.createdAt.toISOString()
  };
}

import { conversationMessageCreateRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationMessageService } from "../../../../../../server/conversation-messages";
import { conversationQueueService } from "../../../../../../server/conversations";
import { requireMobileActor } from "../../../../../../server/mobile/request-auth";
import { runEventService } from "../../../../../../server/run-events";

const querySchema = z.object({
  afterSequence: z.coerce.number().int().nonnegative().optional()
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, actor] = await Promise.all([context.params, requireMobileActor(request)]);
    await assertMobileConversation(actor.workspaceId, id);
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    let messages = await conversationMessageService.listMessages(id, {
      afterSequence: query.afterSequence
    });

    if (!query.afterSequence && messages.length === 0) {
      await backfillMessagesFromRunEvents(id);
      messages = await conversationMessageService.listMessages(id);
    }

    return NextResponse.json({ messages: messages.map(serializeMessage) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load mobile messages" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

async function backfillMessagesFromRunEvents(conversationId: string) {
  const events = await runEventService.listEvents(conversationId);

  for (const event of events) {
    const content = event.content.trim();

    if (!content) {
      continue;
    }

    const role =
      event.type === "approval" && event.metadataJson.role === "user"
        ? "user"
        : event.type === "summary" || event.type === "stdout"
          ? "assistant"
          : event.type === "status" || event.type === "stderr" || event.type === "error"
            ? "runtime"
            : null;

    if (!role) {
      continue;
    }

    await conversationMessageService.appendMessage(conversationId, {
      content,
      role,
      clientMessageId: `run-event-${event.sequence}`,
      metadata: {
        ...event.metadataJson,
        backfilledFromRunEvent: true,
        runEventSequence: event.sequence,
        runEventType: event.type
      }
    });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, actor, input] = await Promise.all([
      context.params,
      requireMobileActor(request),
      conversationMessageCreateRequestSchema.parseAsync(await request.json())
    ]);
    await assertMobileConversation(actor.workspaceId, id);
    const message = await conversationMessageService.appendMessage(id, {
      ...input,
      role: input.role ?? "user",
      sourceDeviceId: input.sourceDeviceId ?? actor.machineId
    });

    return NextResponse.json({ message: serializeMessage(message) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to append mobile message" },
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

  return conversation;
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

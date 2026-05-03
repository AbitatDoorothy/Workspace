import { runEventIngestRequestSchema, type RunEventType } from "@abitat/shared";
import { NextResponse } from "next/server";

import { requireHostToken } from "../../../../../server/hosts/request-auth";
import { conversationMessageService } from "../../../../../server/conversation-messages";
import { runEventService } from "../../../../../server/run-events";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const events = await runEventService.listEvents(id);

  return NextResponse.json({ events });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireHostToken(request);
    const [{ id }, input] = await Promise.all([
      context.params,
      runEventIngestRequestSchema.parseAsync(await request.json())
    ]);

    const event = await runEventService.ingestEvent(id, input);
    await appendConversationMessageForRunEvent(id, {
      content: event.content,
      metadata: event.metadataJson,
      sequence: event.sequence,
      type: event.type
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to ingest run event" },
      { status: error instanceof Error && error.message === "Invalid host token" ? 401 : 400 }
    );
  }
}

async function appendConversationMessageForRunEvent(
  conversationId: string,
  input: {
    sequence: number;
    type: RunEventType;
    content: string;
    metadata: Record<string, unknown>;
  }
) {
  const content = input.content.trim();

  if (!content || input.type === "approval" || input.type === "tool_scan") {
    return;
  }

  await conversationMessageService.appendMessage(conversationId, {
    content,
    role: input.type === "stdout" || input.type === "summary" ? "assistant" : "runtime",
    clientMessageId: `run-event-${input.sequence}`,
    metadata: {
      ...input.metadata,
      runEventSequence: input.sequence,
      runEventType: input.type
    }
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationMessageService } from "../../../../../../server/conversation-messages";
import { conversationQueueService } from "../../../../../../server/conversations";
import { codexAppService, isCodexConversationId } from "../../../../../../server/codex-app";
import { requireMobileActor } from "../../../../../../server/mobile/request-auth";
import { runEventService } from "../../../../../../server/run-events";

const continueRequestSchema = z
  .object({
    prompt: z.string().trim().optional(),
    content: z.string().trim().optional(),
    clientMessageId: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .transform((input) => ({
    prompt: input.prompt ?? input.content ?? "",
    clientMessageId: input.clientMessageId,
    metadata: input.metadata
  }))
  .refine((input) => input.prompt.length > 0, {
    message: "Prompt is required"
  });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, actor, input] = await Promise.all([
      context.params,
      requireMobileActor(request),
      continueRequestSchema.parseAsync(await request.json())
    ]);

    if (!actor.hostMachineId) {
      throw new Error("Phone is not paired to a Mac host");
    }

    if (isCodexConversationId(id)) {
      const conversation = await codexAppService.continueConversation(id, {
        prompt: input.prompt
      });

      return NextResponse.json({
        conversationId: conversation.conversationId,
        message: {
          id: input.clientMessageId ?? `${conversation.conversationId}-${Date.now()}`,
          sequence: 0
        },
        status: conversation.status
      });
    }

    await assertMobileConversation(actor.workspaceId, id);
    const userId = actor.userId ?? "user_demo";
    const message = await conversationMessageService.appendMessage(id, {
      content: input.prompt,
      role: "user",
      sourceDeviceId: actor.machineId,
      clientMessageId: input.clientMessageId,
      metadata: { ...input.metadata, client: "ios", action: "continue" }
    });
    const conversation = await conversationQueueService.continueConversation(id, {
      prompt: input.prompt,
      userId,
      presentation: "remote_chat",
      targetMachineId: actor.hostMachineId
    });
    await runEventService.appendAuditEvent(id, {
      content: input.prompt,
      metadata: { action: "continue", role: "user", sourceDeviceId: actor.machineId, userId }
    });

    return NextResponse.json({
      conversationId: conversation.id,
      message: {
        id: message.id,
        sequence: message.sequence
      },
      status: conversation.status
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to continue mobile conversation" },
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

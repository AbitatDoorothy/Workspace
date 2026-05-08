import { codexModelIdSchema, codexReasoningEffortSchema } from "@abitat/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationMessageService } from "../../../../../../server/conversation-messages";
import { conversationQueueService } from "../../../../../../server/conversations";
import {
  codexAppService,
  isCodexConversationBusyError,
  isCodexConversationId
} from "../../../../../../server/codex-app";
import { mobileActivityLog } from "../../../../../../server/mobile/mobile-activity-log";
import { requireMobileActor } from "../../../../../../server/mobile/request-auth";
import { runEventService } from "../../../../../../server/run-events";

const continueRequestSchema = z
  .object({
    attachments: z
      .array(
        z.object({
          kind: z.enum(["file", "image"]),
          name: z.string().trim().min(1),
          path: z.string().trim().min(1)
        })
      )
      .default([]),
    prompt: z.string().trim().optional(),
    content: z.string().trim().optional(),
    clientMessageId: z.string().min(1).optional(),
    effort: codexReasoningEffortSchema.optional(),
    model: codexModelIdSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .transform((input) => ({
    attachments: input.attachments,
    prompt: input.prompt ?? input.content ?? "",
    clientMessageId: input.clientMessageId,
    effort: input.effort,
    metadata: input.metadata,
    model: input.model
  }))
  .superRefine((input, ctx) => {
    if (Boolean(input.model) !== Boolean(input.effort)) {
      ctx.addIssue({
        code: "custom",
        message: "Codex model and effort must be provided together",
        path: input.model ? ["effort"] : ["model"]
      });
    }
  })
  .refine((input) => input.prompt.length > 0, {
    message: "Prompt is required"
  });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let conversationId = "unknown";
  let actorDetails: Record<string, unknown> = {};
  let requestDetails: Record<string, unknown> = {};

  try {
    const [{ id }, actor, input] = await Promise.all([
      context.params,
      requireMobileActor(request),
      continueRequestSchema.parseAsync(await request.json())
    ]);
    conversationId = id;
    actorDetails = {
      hostMachineId: actor.hostMachineId,
      machineId: actor.machineId,
      workspaceId: actor.workspaceId
    };
    requestDetails = {
      attachmentCount: input.attachments.length,
      clientMessageId: input.clientMessageId ?? "unknown"
    };

    mobileActivityLog.record("mobile_conversation_continue_requested", {
      conversationId,
      ...actorDetails,
      ...requestDetails
    });

    if (!actor.hostMachineId) {
      throw new Error("Phone is not paired to a Mac host");
    }

    if (isCodexConversationId(id)) {
      mobileActivityLog.record("mobile_codex_conversation_continue_requested", {
        attachmentCount: input.attachments.length,
        clientMessageId: input.clientMessageId ?? "unknown",
        conversationId: id,
        hostMachineId: actor.hostMachineId,
        machineId: actor.machineId,
        workspaceId: actor.workspaceId
      });
      const conversation = await codexAppService.continueConversation(id, {
        attachments: input.attachments,
        modelSettings:
          input.model && input.effort ? { effort: input.effort, model: input.model } : undefined,
        prompt: input.prompt
      });
      mobileActivityLog.record("mobile_codex_conversation_continued", {
        conversationId: conversation.conversationId,
        hostMachineId: actor.hostMachineId,
        machineId: actor.machineId,
        status: conversation.status,
        workspaceId: actor.workspaceId
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
      metadata: {
        ...input.metadata,
        attachments: input.attachments,
        client: "ios",
        action: "continue"
      }
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
    mobileActivityLog.record("mobile_conversation_continued", {
      conversationId: conversation.id,
      hostMachineId: actor.hostMachineId,
      machineId: actor.machineId,
      status: conversation.status,
      workspaceId: actor.workspaceId
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
    if (isCodexConversationBusyError(error)) {
      mobileActivityLog.record("mobile_codex_conversation_continue_blocked", {
        conversationId,
        error: error.message,
        reason: "codex_thread_busy",
        ...actorDetails,
        ...requestDetails
      });
    }
    mobileActivityLog.record("mobile_conversation_continue_failed", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
      ...actorDetails,
      ...requestDetails
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to continue mobile conversation" },
      { status: responseStatus(error) }
    );
  }
}

function responseStatus(error: unknown) {
  if (error instanceof Error && error.message === "Invalid mobile token") {
    return 401;
  }

  if (isCodexConversationBusyError(error)) {
    return 409;
  }

  return 400;
}

async function assertMobileConversation(workspaceId: string, conversationId: string) {
  const conversation = (await conversationQueueService.listConversations(workspaceId)).find(
    (candidate) => candidate.id === conversationId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }
}

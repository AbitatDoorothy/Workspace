import {
  codexModelIdSchema,
  codexReasoningEffortSchema,
  conversationCreateRequestSchema
} from "@abitat_reece/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationMessageService } from "../../../../../../server/conversation-messages";
import { conversationQueueService } from "../../../../../../server/conversations";
import {
  codexAppService,
  isCodexConversationBusyError,
  isCodexProjectId
} from "../../../../../../server/codex-app";
import { mobileActivityLog } from "../../../../../../server/mobile/mobile-activity-log";
import { requireMobileActor } from "../../../../../../server/mobile/request-auth";
import { runEventService } from "../../../../../../server/run-events";

const createRequestSchema = conversationCreateRequestSchema
  .pick({
    agentId: true,
    prompt: true,
    runtime: true,
    type: true
  })
  .extend({
    attachments: z
      .array(
        z.object({
          kind: z.enum(["file", "image"]),
          name: z.string().trim().min(1),
          path: z.string().trim().min(1)
        })
      )
      .default([]),
    clientMessageId: z.string().min(1).optional(),
    effort: codexReasoningEffortSchema.optional(),
    model: codexModelIdSchema.optional()
  })
  .superRefine((input, ctx) => {
    if (Boolean(input.model) !== Boolean(input.effort)) {
      ctx.addIssue({
        code: "custom",
        message: "Codex model and effort must be provided together",
        path: input.model ? ["effort"] : ["model"]
      });
    }
  });

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const startedAt = Date.now();
  let projectIdForLog = "unknown";
  let actorDetails: Record<string, unknown> = {};

  try {
    const [{ projectId }, actor] = await Promise.all([context.params, requireMobileActor(request)]);
    projectIdForLog = projectId;
    actorDetails = {
      hostMachineId: actor.hostMachineId,
      machineId: actor.machineId,
      workspaceId: actor.workspaceId
    };

    if (isCodexProjectId(projectId)) {
      const conversations = await codexAppService.listProjectConversations(projectId);
      mobileActivityLog.record("mobile_conversations_listed", {
        conversationCount: conversations.length,
        durationMs: Date.now() - startedAt,
        latestConversationId: conversations[0]?.id ?? null,
        latestConversationStatus: conversations[0]?.status ?? null,
        latestConversationUpdatedAt: conversations[0]?.updatedAt?.toISOString() ?? null,
        projectId,
        source: "codex_app",
        ...actorDetails
      });
      return mobileJson({ conversations });
    }

    const conversations = (await conversationQueueService.listConversations(actor.workspaceId))
      .filter((conversation) => conversation.projectId === projectId)
      .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0));
    mobileActivityLog.record("mobile_conversations_listed", {
      conversationCount: conversations.length,
      durationMs: Date.now() - startedAt,
      latestConversationId: conversations[0]?.id ?? null,
      latestConversationStatus: conversations[0]?.status ?? null,
      latestConversationUpdatedAt: conversations[0]?.createdAt?.toISOString() ?? null,
      projectId,
      source: "abitat",
      ...actorDetails
    });

    return mobileJson({ conversations });
  } catch (error) {
    mobileActivityLog.record("mobile_conversations_list_failed", {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      projectId: projectIdForLog,
      ...actorDetails
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list mobile conversations" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  let projectIdForLog = "unknown";
  let actorDetails: Record<string, unknown> = {};

  try {
    const [{ projectId }, actor, input] = await Promise.all([
      context.params,
      requireMobileActor(request),
      createRequestSchema.parseAsync(await request.json())
    ]);
    projectIdForLog = projectId;
    actorDetails = {
      hostMachineId: actor.hostMachineId,
      machineId: actor.machineId,
      workspaceId: actor.workspaceId
    };

    if (!actor.hostMachineId) {
      throw new Error("Phone is not paired to a Mac host");
    }

    if (isCodexProjectId(projectId)) {
      const conversation = await codexAppService.startConversation(projectId, {
        attachments: input.attachments,
        modelSettings:
          input.model && input.effort ? { effort: input.effort, model: input.model } : undefined,
        prompt: input.prompt
      });
      mobileActivityLog.record("mobile_codex_conversation_started", {
        conversationId: conversation.conversationId,
        hostMachineId: actor.hostMachineId,
        machineId: actor.machineId,
        projectId,
        status: conversation.status,
        workspaceId: actor.workspaceId
      });

      return mobileJson(conversation, { status: 201 });
    }

    const userId = actor.userId ?? "user_demo";
    const conversation = await conversationQueueService.createConversation({
      workspaceId: actor.workspaceId,
      projectId,
      agentId: input.agentId,
      runtime: input.runtime,
      createdByUserId: userId,
      type: input.type,
      prompt: input.prompt,
      presentation: "remote_chat",
      targetMachineId: actor.hostMachineId
    });

    if (input.prompt.trim()) {
      await conversationMessageService.appendMessage(conversation.id, {
        content: input.prompt,
        role: "user",
        sourceDeviceId: actor.machineId,
        clientMessageId: input.clientMessageId,
        metadata: { attachments: input.attachments, client: "ios", action: "start" }
      });
      await runEventService.appendAuditEvent(conversation.id, {
        content: input.prompt,
        metadata: { action: "start", role: "user", sourceDeviceId: actor.machineId, userId }
      });
    }
    mobileActivityLog.record("mobile_conversation_started", {
      conversationId: conversation.id,
      hostMachineId: actor.hostMachineId,
      machineId: actor.machineId,
      projectId,
      status: conversation.status,
      workspaceId: actor.workspaceId
    });

    return mobileJson(
      {
        conversationId: conversation.id,
        status: conversation.status
      },
      { status: 201 }
    );
  } catch (error) {
    mobileActivityLog.record("mobile_conversation_start_failed", {
      error: error instanceof Error ? error.message : String(error),
      projectId: projectIdForLog,
      reason: isCodexConversationBusyError(error) ? "codex_thread_busy" : "request_failed",
      ...actorDetails
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start mobile conversation" },
      { status: responseStatus(error) }
    );
  }
}

function mobileJson(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...Object.fromEntries(new Headers(init.headers))
    }
  });
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

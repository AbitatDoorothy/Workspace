import { conversationCreateRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationMessageService } from "../../../../../../server/conversation-messages";
import { conversationQueueService } from "../../../../../../server/conversations";
import { codexAppService, isCodexProjectId } from "../../../../../../server/codex-app";
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
    clientMessageId: z.string().min(1).optional()
  });

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const [{ projectId }, actor] = await Promise.all([context.params, requireMobileActor(request)]);

    if (isCodexProjectId(projectId)) {
      const conversations = await codexAppService.listProjectConversations(projectId);
      return NextResponse.json({ conversations });
    }

    const conversations = (await conversationQueueService.listConversations(actor.workspaceId))
      .filter((conversation) => conversation.projectId === projectId)
      .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0));

    return NextResponse.json({ conversations });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list mobile conversations" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const [{ projectId }, actor, input] = await Promise.all([
      context.params,
      requireMobileActor(request),
      createRequestSchema.parseAsync(await request.json())
    ]);

    if (!actor.hostMachineId) {
      throw new Error("Phone is not paired to a Mac host");
    }

    if (isCodexProjectId(projectId)) {
      const conversation = await codexAppService.startConversation(projectId, {
        prompt: input.prompt
      });

      return NextResponse.json(conversation, { status: 201 });
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
        metadata: { client: "ios", action: "start" }
      });
      await runEventService.appendAuditEvent(conversation.id, {
        content: input.prompt,
        metadata: { action: "start", role: "user", sourceDeviceId: actor.machineId, userId }
      });
    }

    return NextResponse.json(
      {
        conversationId: conversation.id,
        status: conversation.status
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start mobile conversation" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

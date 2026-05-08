import { conversationCreateRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequestAccountContext } from "../../../server/auth/request-session";
import { createBrowserRedirectUrl } from "../../../server/auth/session";
import { conversationQueueService } from "../../../server/conversations";
import { runEventService } from "../../../server/run-events";
import { todoStore } from "../../../server/todos";

const conversationRequestSchema = conversationCreateRequestSchema.extend({
  workspaceId: z.string().min(1).default("workspace_demo"),
  createdByUserId: z.string().min(1).default("user_demo"),
  prompt: z.string().trim().default(""),
  todoTitle: z.string().trim().optional(),
  redirectTo: z.string().min(1).optional()
});

export async function POST(request: Request) {
  try {
    const body = await parseRequest(request);
    const account = await getRequestAccountContext(request);
    const input = {
      ...conversationRequestSchema.parse(body),
      workspaceId: account.workspaceId,
      createdByUserId: account.userId
    };
    const todoTask = input.todoTitle ? todoStore.startCodexTask(input.todoTitle) : null;
    const conversationInput = {
      ...input,
      prompt: todoTask?.title ?? input.prompt
    };
    const conversation = await conversationQueueService.createConversation(conversationInput);

    if (todoTask) {
      todoStore.linkConversation(todoTask.id, conversation.id);
    }

    await runEventService.appendAuditEvent(conversation.id, {
      content: conversationInput.prompt,
      metadata: { action: "start", role: "user", userId: conversation.createdByUserId }
    });

    if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(
        createBrowserRedirectUrl(
          request,
          input.redirectTo ?? `/projects/${conversation.projectId}`
        ),
        303
      );
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
      { error: error instanceof Error ? error.message : "Unable to create conversation" },
      { status: 400 }
    );
  }
}

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(await request.formData());
  }

  return request.json();
}

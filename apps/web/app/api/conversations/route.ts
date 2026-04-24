import { conversationCreateRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationQueueService } from "../../../server/conversations";

const conversationRequestSchema = conversationCreateRequestSchema.extend({
  workspaceId: z.string().min(1).default("workspace_demo"),
  createdByUserId: z.string().min(1).default("user_demo"),
  prompt: z.string().trim().min(1)
});

export async function POST(request: Request) {
  try {
    const body = await parseRequest(request);
    const conversation = await conversationQueueService.createConversation(
      conversationRequestSchema.parse(body)
    );

    if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(new URL("/conversations", request.url), 303);
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

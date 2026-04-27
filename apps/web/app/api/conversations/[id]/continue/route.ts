import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationQueueService } from "../../../../../server/conversations";
import { runEventService } from "../../../../../server/run-events";

const continueRequestSchema = z.object({
  prompt: z.string().trim().min(1),
  userId: z.string().min(1).default("user_demo"),
  redirectTo: z.string().min(1).optional()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, input] = await Promise.all([
      context.params,
      continueRequestSchema.parseAsync(await parseRequest(request))
    ]);
    const conversation = await conversationQueueService.continueConversation(id, input);
    await runEventService.appendAuditEvent(id, {
      content: input.prompt,
      metadata: { action: "continue", role: "user", userId: input.userId }
    });

    if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(
        new URL(
          input.redirectTo ?? `/projects/${conversation.projectId}/conversations/${id}`,
          request.url
        ),
        303
      );
    }

    return NextResponse.json({
      conversationId: conversation.id,
      status: conversation.status
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to continue conversation" },
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

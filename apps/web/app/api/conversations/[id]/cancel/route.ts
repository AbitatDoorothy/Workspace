import { NextResponse } from "next/server";
import { z } from "zod";

import { createBrowserRedirectUrl } from "../../../../../server/auth/session";
import { conversationQueueService } from "../../../../../server/conversations";
import { runEventService } from "../../../../../server/run-events";

const cancelRequestSchema = z.object({
  userId: z.string().min(1).default("user_demo")
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, input] = await Promise.all([
      context.params,
      cancelRequestSchema.parseAsync(await parseRequest(request))
    ]);
    const response = await conversationQueueService.cancelConversation(id, input);
    await runEventService.appendAuditEvent(id, {
      content: "Conversation cancelled",
      metadata: { action: "cancel", userId: input.userId }
    });

    if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(createBrowserRedirectUrl(request, "/projects"), 303);
    }

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to cancel conversation" },
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

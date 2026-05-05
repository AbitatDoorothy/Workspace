import { NextResponse } from "next/server";
import { z } from "zod";

import { createBrowserRedirectUrl } from "../../../../../server/auth/session";
import { conversationQueueService } from "../../../../../server/conversations";
import {
  codexAppDeepLink,
  codexAppService,
  isCodexConversationId,
  toCodexThreadId
} from "../../../../../server/codex-app";
import { runEventService } from "../../../../../server/run-events";

const continueRequestSchema = z.object({
  prompt: z.string().trim().default(""),
  userId: z.string().min(1).default("user_demo"),
  redirectTo: z.string().min(1).optional()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, input] = await Promise.all([
      context.params,
      continueRequestSchema.parseAsync(await parseRequest(request))
    ]);

    if (isCodexConversationId(id)) {
      if (input.prompt) {
        await codexAppService.continueConversation(id, {
          prompt: input.prompt
        });
      }

      if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
        return NextResponse.redirect(codexAppDeepLink(toCodexThreadId(id)), 303);
      }

      return NextResponse.json({
        conversationId: id,
        status: input.prompt ? "running" : "approved"
      });
    }

    const conversation = await conversationQueueService.continueConversation(id, input);
    await runEventService.appendAuditEvent(id, {
      content: input.prompt,
      metadata: { action: "continue", role: "user", userId: input.userId }
    });

    if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(
        createBrowserRedirectUrl(
          request,
          input.redirectTo ?? `/projects/${conversation.projectId}/conversations/${id}`
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

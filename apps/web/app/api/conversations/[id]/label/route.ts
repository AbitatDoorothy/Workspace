import { NextResponse } from "next/server";
import { z } from "zod";

import { createBrowserRedirectUrl } from "../../../../../server/auth/session";
import { conversationQueueService } from "../../../../../server/conversations";

const labelRequestSchema = z.object({
  label: z.enum(["in_process", "complete"]),
  userId: z.string().min(1).default("user_demo"),
  redirectTo: z.string().min(1).optional()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, input] = await Promise.all([
      context.params,
      labelRequestSchema.parseAsync(await parseRequest(request))
    ]);
    const conversation = await conversationQueueService.setConversationLabel(id, input);

    if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(
        createBrowserRedirectUrl(
          request,
          input.redirectTo ?? `/projects/${conversation.projectId}`
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
      { error: error instanceof Error ? error.message : "Unable to update conversation label" },
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

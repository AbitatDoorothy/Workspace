import { NextResponse } from "next/server";
import { z } from "zod";

import { createPublicRedirectUrl } from "../../../../../server/auth/session";
import { conversationQueueService } from "../../../../../server/conversations";

const deleteRequestSchema = z.object({
  userId: z.string().min(1).default("user_demo"),
  redirectTo: z.string().min(1).optional()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, input] = await Promise.all([
      context.params,
      deleteRequestSchema.parseAsync(await parseRequest(request))
    ]);

    await conversationQueueService.deleteConversation(id, input);

    if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(
        createPublicRedirectUrl(request, input.redirectTo ?? "/projects"),
        303
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete conversation" },
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

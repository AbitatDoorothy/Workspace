import { approvalRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createPublicRedirectUrl } from "../../../../../server/auth/session";
import { reviewService } from "../../../../../server/reviews";
import { runEventService } from "../../../../../server/run-events";

const approveRequestSchema = approvalRequestSchema.extend({
  approvedByUserId: z.string().min(1).default("user_demo")
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, input] = await Promise.all([
      context.params,
      approveRequestSchema.parseAsync(await parseRequest(request))
    ]);
    const response = await reviewService.approveConversation(id, input);
    await runEventService.appendAuditEvent(id, {
      content: "Commit and push approved",
      metadata: { action: "approval", userId: input.approvedByUserId }
    });

    if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(createPublicRedirectUrl(request, "/conversations"), 303);
    }

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to approve conversation" },
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

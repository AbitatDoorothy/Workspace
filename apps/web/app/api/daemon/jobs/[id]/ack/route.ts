import { daemonJobAckRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";

import { conversationQueueService } from "../../../../../../server/conversations";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, input] = await Promise.all([
      context.params,
      daemonJobAckRequestSchema.parseAsync(await request.json())
    ]);

    await conversationQueueService.ackJob(id, input.status, input.errorMessage);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to acknowledge daemon job" },
      { status: 400 }
    );
  }
}

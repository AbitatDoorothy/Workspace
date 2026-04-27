import { daemonJobPollRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";

import { conversationQueueService } from "../../../../../server/conversations";

export async function POST(request: Request) {
  try {
    const input = daemonJobPollRequestSchema.parse(await request.json());
    await conversationQueueService.recoverStaleJobs(input.machineId, {
      activeConversationId: input.activeConversationId
    });
    const job = await conversationQueueService.pollNextJob(input.machineId);

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to poll daemon job" },
      { status: 400 }
    );
  }
}

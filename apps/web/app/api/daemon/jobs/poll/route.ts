import { daemonJobPollRequestSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";

import { conversationQueueService } from "../../../../../server/conversations";
import { requireHostToken } from "../../../../../server/hosts/request-auth";

export async function POST(request: Request) {
  try {
    const input = daemonJobPollRequestSchema.parse(await request.json());
    await requireHostToken(request, input.machineId);
    await conversationQueueService.recoverStaleJobs(input.machineId, {
      activeConversationId: input.activeConversationId,
      activeConversationIds: input.activeConversationIds
    });
    const job = await conversationQueueService.pollNextJob(input.machineId);

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to poll daemon job" },
      { status: error instanceof Error && error.message === "Invalid host token" ? 401 : 400 }
    );
  }
}

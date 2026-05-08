import { hostHeartbeatRequestSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";

import { conversationQueueService } from "../../../../server/conversations";
import { hostService } from "../../../../server/hosts";
import { getBearerToken } from "../../../../server/hosts/request-auth";

export async function POST(request: Request) {
  try {
    const body = hostHeartbeatRequestSchema.parse(await request.json());
    const token = getBearerToken(request);
    const response = await hostService.recordHeartbeat(body, token);
    await conversationQueueService.recoverStaleJobs(body.machineId, {
      activeConversationId: body.activeConversationId,
      activeConversationIds: body.activeConversationIds
    });
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to record heartbeat" },
      { status: 401 }
    );
  }
}

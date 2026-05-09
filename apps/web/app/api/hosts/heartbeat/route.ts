import { hostHeartbeatRequestSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";

import { conversationQueueService } from "../../../../server/conversations";
import { isDbOperationTimeout, runDbOperation } from "../../../../server/db/operation";
import { hostService } from "../../../../server/hosts";
import { getBearerToken } from "../../../../server/hosts/request-auth";

const STALE_JOB_RECOVERY_TIMEOUT_MS = 1500;

export async function POST(request: Request) {
  try {
    const body = hostHeartbeatRequestSchema.parse(await request.json());
    const token = getBearerToken(request);
    const response = await hostService.recordHeartbeat(body, token);
    await runDbOperation(
      "host_heartbeat_recover_stale_jobs",
      () =>
        conversationQueueService.recoverStaleJobs(body.machineId, {
          activeConversationId: body.activeConversationId,
          activeConversationIds: body.activeConversationIds
        }),
      STALE_JOB_RECOVERY_TIMEOUT_MS
    ).catch((error: unknown) => {
      console.warn("host heartbeat stale job recovery skipped", {
        message: error instanceof Error ? error.message : String(error)
      });
    });
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to record heartbeat" },
      { status: isDbOperationTimeout(error) ? 503 : 401 }
    );
  }
}

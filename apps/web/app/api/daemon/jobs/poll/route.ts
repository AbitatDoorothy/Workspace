import { daemonJobPollRequestSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";

import { conversationQueueService } from "../../../../../server/conversations";
import {
  DEFAULT_DB_OPERATION_TIMEOUT_MS,
  isDbOperationTimeout,
  runDbOperation
} from "../../../../../server/db/operation";
import { requireHostToken } from "../../../../../server/hosts/request-auth";

const STALE_JOB_RECOVERY_TIMEOUT_MS = 1500;

export async function POST(request: Request) {
  try {
    const input = daemonJobPollRequestSchema.parse(await request.json());
    await requireHostToken(request, input.machineId);
    await runDbOperation(
      "daemon_job_poll_recover_stale_jobs",
      () =>
        conversationQueueService.recoverStaleJobs(input.machineId, {
          activeConversationId: input.activeConversationId,
          activeConversationIds: input.activeConversationIds
        }),
      STALE_JOB_RECOVERY_TIMEOUT_MS
    ).catch((error: unknown) => {
      console.warn("daemon job poll stale job recovery skipped", {
        message: error instanceof Error ? error.message : String(error)
      });
    });
    const job = await runDbOperation(
      "daemon_job_poll_next",
      () => conversationQueueService.pollNextJob(input.machineId),
      DEFAULT_DB_OPERATION_TIMEOUT_MS
    ).catch((error: unknown) => {
      if (!isDbOperationTimeout(error)) {
        throw error;
      }

      console.warn("daemon job poll skipped", {
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    });

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to poll daemon job" },
      { status: jobPollErrorStatus(error) }
    );
  }
}

function jobPollErrorStatus(error: unknown) {
  if (error instanceof Error && error.message === "Invalid host token") {
    return 401;
  }
  if (isDbOperationTimeout(error)) {
    return 503;
  }
  return 400;
}

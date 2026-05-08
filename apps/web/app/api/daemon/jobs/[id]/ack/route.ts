import { daemonJobAckRequestSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";

import { conversationQueueService } from "../../../../../../server/conversations";
import { requireHostToken } from "../../../../../../server/hosts/request-auth";
import { runEventService } from "../../../../../../server/run-events";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireHostToken(request);
    const [{ id }, input] = await Promise.all([
      context.params,
      daemonJobAckRequestSchema.parseAsync(await request.json())
    ]);

    const job = await conversationQueueService.ackJob(id, input.status, {
      branchName: input.branchName,
      commitSha: input.commitSha,
      errorMessage: input.errorMessage,
      prUrl: input.prUrl,
      runtimeSessionId: input.runtimeSessionId,
      worktreePath: input.worktreePath
    });
    await appendDaemonAuditEvent(job.conversationId, input);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to acknowledge daemon job" },
      { status: error instanceof Error && error.message === "Invalid host token" ? 401 : 400 }
    );
  }
}

async function appendDaemonAuditEvent(
  conversationId: string | null,
  input: {
    status: "running" | "completed" | "failed";
    commitSha?: string;
    errorMessage?: string;
  }
) {
  if (!conversationId || (!input.commitSha && input.status !== "failed")) {
    return;
  }

  const content =
    input.status === "failed" ? "Daemon job failed" : `Branch pushed at ${input.commitSha}`;
  const action = input.status === "failed" ? "failure" : "push";

  await runEventService
    .appendAuditEvent(conversationId, {
      content,
      metadata: { action, errorMessage: input.errorMessage }
    })
    .catch(() => undefined);
}

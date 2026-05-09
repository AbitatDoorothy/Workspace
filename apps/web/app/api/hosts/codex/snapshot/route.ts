import { NextResponse } from "next/server";
import { z } from "zod";

import { hostCodexSnapshotService, hostService } from "../../../../../server/hosts";
import type { HostCodexSnapshot } from "../../../../../server/hosts/codex-snapshot-service";
import { requireHostToken } from "../../../../../server/hosts/request-auth";
import { mobileActivityLog } from "../../../../../server/mobile/mobile-activity-log";

const requestSchema = z.object({
  machineId: z.string().min(1),
  snapshot: z.object({
    completions: z.array(z.record(z.string(), z.unknown())).default([]),
    conversations: z.array(z.record(z.string(), z.unknown())).default([]),
    messages: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
    models: z.array(z.record(z.string(), z.unknown())).default([]),
    projects: z.array(z.record(z.string(), z.unknown())).default([]),
    syncedAt: z.string().min(1).optional()
  })
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const token = await requireHostToken(request, input.machineId);
    const signedHost = hostService.readSignedHostToken(token);
    const snapshot = await hostCodexSnapshotService.recordSnapshot({
      machineId: input.machineId,
      signedHost,
      snapshot: input.snapshot as unknown as HostCodexSnapshot
    });

    mobileActivityLog.record("host_codex_snapshot_uploaded", {
      completionCount: snapshot.completions.length,
      conversationCount: snapshot.conversations.length,
      machineId: input.machineId,
      messageConversationCount: Object.keys(snapshot.messages).length,
      modelCount: snapshot.models.length,
      projectCount: snapshot.projects.length
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload Codex snapshot" },
      { status: snapshotErrorStatus(error) }
    );
  }
}

function snapshotErrorStatus(error: unknown) {
  if (error instanceof Error && error.message === "Invalid host token") {
    return 401;
  }
  if (error instanceof Error && error.message.toLowerCase().includes("timeout")) {
    return 503;
  }
  return 400;
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { mobileActivityLog } from "../../../../server/mobile/mobile-activity-log";
import { requireMobileActor } from "../../../../server/mobile/request-auth";
import { saveMobileUpload } from "../../../../server/mobile/mobile-uploads";

const uploadSchema = z.object({
  dataBase64: z.string().min(1),
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(120)
});

export async function POST(request: Request) {
  let actorDetails: Record<string, unknown> = {};

  try {
    const [actor, input] = await Promise.all([
      requireMobileActor(request),
      uploadSchema.parseAsync(await request.json())
    ]);
    actorDetails = {
      machineId: actor.machineId,
      workspaceId: actor.workspaceId
    };
    const attachment = await saveMobileUpload(actor, input);

    mobileActivityLog.record("mobile_attachment_uploaded", {
      kind: attachment.kind,
      machineId: actor.machineId,
      mimeType: attachment.mimeType,
      name: attachment.name,
      size: attachment.size,
      workspaceId: actor.workspaceId
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    mobileActivityLog.record("mobile_attachment_upload_failed", {
      error: error instanceof Error ? error.message : String(error),
      ...actorDetails
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload attachment" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

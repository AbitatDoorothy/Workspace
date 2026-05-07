import { NextResponse } from "next/server";
import { z } from "zod";

import { mobileService } from "../../../../../server/mobile";
import { mobileActivityLog } from "../../../../../server/mobile/mobile-activity-log";
import { formatMobilePushRegistrationDiagnostic } from "../../../../../server/mobile/mobile-push-diagnostics";
import { requireMobileActor } from "../../../../../server/mobile/request-auth";

const pushRegistrationDiagnosticSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  stage: z.string().trim().min(1).max(80)
});

export async function POST(request: Request) {
  try {
    const [actor, input] = await Promise.all([
      requireMobileActor(request),
      pushRegistrationDiagnosticSchema.parseAsync(await request.json())
    ]);

    await mobileService.recordPushRegistrationDiagnostic(actor, input);
    mobileActivityLog.record("mobile_push_registration_diagnostic", {
      hostMachineId: actor.hostMachineId ?? "unknown",
      machineId: actor.machineId,
      message: input.message,
      stage: input.stage,
      workspaceId: actor.workspaceId
    });

    console.warn(
      formatMobilePushRegistrationDiagnostic({
        hostMachineId: actor.hostMachineId,
        machineId: actor.machineId,
        message: input.message,
        stage: input.stage,
        workspaceId: actor.workspaceId
      })
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to record push diagnostics" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

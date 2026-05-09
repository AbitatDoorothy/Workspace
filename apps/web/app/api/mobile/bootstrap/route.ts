import { NextResponse } from "next/server";

import { isDbOperationTimeout } from "../../../../server/db/operation";
import { mobileService } from "../../../../server/mobile";
import { mobileActivityLog } from "../../../../server/mobile/mobile-activity-log";
import { requireMobileActor } from "../../../../server/mobile/request-auth";

export async function GET(request: Request) {
  const startedAt = Date.now();
  let actorDetails: Record<string, unknown> = {};

  try {
    const actor = await requireMobileActor(request);
    actorDetails = {
      hostMachineId: actor.hostMachineId,
      machineId: actor.machineId,
      workspaceId: actor.workspaceId
    };
    const bootstrap = await mobileService.bootstrap(actor);
    mobileActivityLog.record("mobile_bootstrap_loaded", {
      durationMs: Date.now() - startedAt,
      hostStatus: bootstrap.host?.status ?? "missing",
      phoneStatus: bootstrap.phone.status,
      ...actorDetails
    });

    return NextResponse.json(bootstrap);
  } catch (error) {
    mobileActivityLog.record("mobile_bootstrap_failed", {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      ...actorDetails
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load mobile bootstrap" },
      {
        status: isDbOperationTimeout(error)
          ? 503
          : error instanceof Error && error.message === "Invalid mobile token"
            ? 401
            : 400
      }
    );
  }
}

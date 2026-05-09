import { NextResponse } from "next/server";

import { codexAppService } from "../../../../server/codex-app";
import { hostCodexSnapshotService } from "../../../../server/hosts";
import { mobileService } from "../../../../server/mobile";
import { canUseLocalCodexApp } from "../../../../server/mobile/codex-host-access";
import { mobileActivityLog } from "../../../../server/mobile/mobile-activity-log";
import { requireMobileActor } from "../../../../server/mobile/request-auth";

export async function GET(request: Request) {
  try {
    const actor = await requireMobileActor(request);
    const useLocalCodexApp = await canUseLocalCodexApp(actor);
    const [localProjects, codexProjects] = await Promise.allSettled([
      mobileService.listProjects(actor),
      useLocalCodexApp
        ? codexAppService.listProjects()
        : hostCodexSnapshotService.listProjects({
            hostMachineId: actor.hostMachineId,
            workspaceId: actor.workspaceId
          })
    ]);
    mobileActivityLog.record("mobile_projects_listed", {
      codexAccess: useLocalCodexApp ? "local_host" : "denied_cross_host",
      codexProjectCount: codexProjects.status === "fulfilled" ? codexProjects.value.length : 0,
      codexProjectError:
        codexProjects.status === "rejected" ? errorMessage(codexProjects.reason) : null,
      hostMachineId: actor.hostMachineId,
      localProjectCount: localProjects.status === "fulfilled" ? localProjects.value.length : 0,
      localProjectError:
        localProjects.status === "rejected" ? errorMessage(localProjects.reason) : null,
      machineId: actor.machineId,
      workspaceId: actor.workspaceId
    });

    return NextResponse.json({
      projects: [
        ...(codexProjects.status === "fulfilled" ? codexProjects.value : []),
        ...(localProjects.status === "fulfilled" ? localProjects.value : [])
      ]
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list mobile projects" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

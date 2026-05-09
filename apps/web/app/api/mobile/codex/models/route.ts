import { codexModelOptionsResponseSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";

import { codexAppService } from "../../../../../server/codex-app";
import { hostCodexSnapshotService } from "../../../../../server/hosts";
import { canUseLocalCodexApp } from "../../../../../server/mobile/codex-host-access";
import { requireMobileActor } from "../../../../../server/mobile/request-auth";

export async function GET(request: Request) {
  try {
    const actor = await requireMobileActor(request);
    const models = (await canUseLocalCodexApp(actor))
      ? await codexAppService.listModelOptions()
      : await hostCodexSnapshotService.listModelOptions({
          hostMachineId: actor.hostMachineId,
          workspaceId: actor.workspaceId
        });

    return NextResponse.json(codexModelOptionsResponseSchema.parse({ models }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list Codex models" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

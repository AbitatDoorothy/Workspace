import { remoteControlSessionCreateRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";

import { requireMobileActor } from "../../../../server/mobile/request-auth";
import { remoteControlService } from "../../../../server/remote-control";

export async function GET(request: Request) {
  try {
    const actor = await requireMobileActor(request);

    if (!actor.hostMachineId) {
      return NextResponse.json({ sessions: [] });
    }

    const sessions = (await remoteControlService.pollHostSessions(actor.hostMachineId)).filter(
      (session) => session.clientMachineId === actor.machineId
    );

    return NextResponse.json({ sessions: sessions.map(serializeSession) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list remote-control sessions" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const [actor, input] = await Promise.all([
      requireMobileActor(request),
      remoteControlSessionCreateRequestSchema.parseAsync(await request.json())
    ]);

    if (!actor.hostMachineId || input.hostMachineId !== actor.hostMachineId) {
      throw new Error("Phone is not paired to this Mac host");
    }

    const session = await remoteControlService.createSession({
      workspaceId: actor.workspaceId,
      hostMachineId: input.hostMachineId,
      clientMachineId: actor.machineId,
      createdByUserId: actor.userId ?? "user_demo",
      screenEnabled: input.screenEnabled,
      inputEnabled: input.inputEnabled
    });

    return NextResponse.json({ session: serializeSession(session) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create remote-control session" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

function serializeSession(session: {
  id: string;
  status: string;
  hostMachineId: string;
  clientMachineId: string;
  screenEnabled: boolean;
  inputEnabled: boolean;
  errorMessage?: string | null;
}) {
  return {
    id: session.id,
    status: session.status,
    hostMachineId: session.hostMachineId,
    clientMachineId: session.clientMachineId,
    screenEnabled: session.screenEnabled,
    inputEnabled: session.inputEnabled,
    errorMessage: session.errorMessage ?? null
  };
}

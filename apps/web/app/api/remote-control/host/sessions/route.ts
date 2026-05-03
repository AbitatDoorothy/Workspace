import { NextResponse } from "next/server";
import { z } from "zod";

import { requireHostToken } from "../../../../../server/hosts/request-auth";
import { remoteControlService } from "../../../../../server/remote-control";

const querySchema = z.object({
  machineId: z.string().min(1)
});

export async function GET(request: Request) {
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    await requireHostToken(request, query.machineId);
    const sessions = await remoteControlService.pollHostSessions(query.machineId);

    return NextResponse.json({ sessions: sessions.map(serializeSession) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to poll remote-control sessions" },
      { status: error instanceof Error && error.message === "Invalid host token" ? 401 : 400 }
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

import { remoteControlStatusSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireHostToken } from "../../../../../../server/hosts/request-auth";
import { remoteControlService } from "../../../../../../server/remote-control";

const updateRequestSchema = z.object({
  status: remoteControlStatusSchema,
  errorMessage: z.string().min(1).optional()
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, input] = await Promise.all([
      context.params,
      updateRequestSchema.parseAsync(await request.json())
    ]);
    const session = await remoteControlService.getSession(id);

    if (!session) {
      throw new Error("Remote-control session not found");
    }

    await requireHostToken(request, session.hostMachineId);
    const updated = await remoteControlService.updateSessionStatus(
      id,
      input.status,
      input.errorMessage
    );

    return NextResponse.json({ session: serializeSession(updated) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update remote-control session" },
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

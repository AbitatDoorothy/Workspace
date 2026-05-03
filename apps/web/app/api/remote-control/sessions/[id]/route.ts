import { remoteControlStatusSchema } from "@abitat/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMobileActor } from "../../../../../server/mobile/request-auth";
import { remoteControlService } from "../../../../../server/remote-control";

const updateRequestSchema = z.object({
  status: remoteControlStatusSchema,
  errorMessage: z.string().min(1).optional()
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, actor] = await Promise.all([context.params, requireMobileActor(request)]);
    const session = await requireMobileSession(id, actor.machineId);

    return NextResponse.json({ session: serializeSession(session) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load remote-control session" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, actor, input] = await Promise.all([
      context.params,
      requireMobileActor(request),
      updateRequestSchema.parseAsync(await request.json())
    ]);
    await requireMobileSession(id, actor.machineId);
    const session = await remoteControlService.updateSessionStatus(
      id,
      input.status,
      input.errorMessage
    );

    return NextResponse.json({ session: serializeSession(session) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update remote-control session" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, actor] = await Promise.all([context.params, requireMobileActor(request)]);
    await requireMobileSession(id, actor.machineId);
    const session = await remoteControlService.updateSessionStatus(id, "ended");

    return NextResponse.json({ session: serializeSession(session) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to end remote-control session" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

async function requireMobileSession(sessionId: string, clientMachineId: string) {
  const session = await remoteControlService.getSession(sessionId);

  if (!session || session.clientMachineId !== clientMachineId) {
    throw new Error("Remote-control session not found");
  }

  return session;
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

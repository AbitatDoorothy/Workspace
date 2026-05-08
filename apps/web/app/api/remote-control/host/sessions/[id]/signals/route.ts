import { remoteControlSignalTypeSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireHostToken } from "../../../../../../../server/hosts/request-auth";
import { remoteControlService } from "../../../../../../../server/remote-control";

const signalRequestSchema = z.object({
  recipientMachineId: z.string().min(1).optional(),
  type: remoteControlSignalTypeSchema,
  payload: z.record(z.string(), z.unknown())
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = await requireHostSession(request, id);
    const signals = await remoteControlService.listSignals(id, session.hostMachineId);

    return NextResponse.json({ signals: signals.map(serializeSignal) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list remote-control signals" },
      { status: error instanceof Error && error.message === "Invalid host token" ? 401 : 400 }
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, input] = await Promise.all([
      context.params,
      signalRequestSchema.parseAsync(await request.json())
    ]);
    const session = await requireHostSession(request, id);
    const signal = await remoteControlService.addSignal({
      sessionId: id,
      senderMachineId: session.hostMachineId,
      recipientMachineId: input.recipientMachineId ?? session.clientMachineId,
      type: input.type,
      payload: input.payload
    });

    return NextResponse.json({ signal: serializeSignal(signal) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to add remote-control signal" },
      { status: error instanceof Error && error.message === "Invalid host token" ? 401 : 400 }
    );
  }
}

async function requireHostSession(request: Request, sessionId: string) {
  const session = await remoteControlService.getSession(sessionId);

  if (!session) {
    throw new Error("Remote-control session not found");
  }

  await requireHostToken(request, session.hostMachineId);
  return session;
}

function serializeSignal(signal: {
  id: string;
  sessionId: string;
  senderMachineId: string;
  recipientMachineId?: string | null;
  type: string;
  payloadJson: Record<string, unknown>;
  createdAt: Date;
}) {
  return {
    id: signal.id,
    sessionId: signal.sessionId,
    senderMachineId: signal.senderMachineId,
    recipientMachineId: signal.recipientMachineId ?? null,
    type: signal.type,
    payload: signal.payloadJson,
    createdAt: signal.createdAt.toISOString()
  };
}

import { remoteControlSignalTypeSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMobileActor } from "../../../../../../server/mobile/request-auth";
import { remoteControlService } from "../../../../../../server/remote-control";

const signalRequestSchema = z.object({
  recipientMachineId: z.string().min(1).optional(),
  type: remoteControlSignalTypeSchema,
  payload: z.record(z.string(), z.unknown())
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, actor] = await Promise.all([context.params, requireMobileActor(request)]);
    await requireMobileSession(id, actor.machineId);
    const signals = await remoteControlService.listSignals(id, actor.machineId);

    return NextResponse.json({ signals: signals.map(serializeSignal) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list remote-control signals" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, actor, input] = await Promise.all([
      context.params,
      requireMobileActor(request),
      signalRequestSchema.parseAsync(await request.json())
    ]);
    const session = await requireMobileSession(id, actor.machineId);
    const signal = await remoteControlService.addSignal({
      sessionId: id,
      senderMachineId: actor.machineId,
      recipientMachineId: input.recipientMachineId ?? session.hostMachineId,
      type: input.type,
      payload: input.payload
    });

    return NextResponse.json({ signal: serializeSignal(signal) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to add remote-control signal" },
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

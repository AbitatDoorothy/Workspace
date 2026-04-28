import { runEventIngestRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";

import { requireHostToken } from "../../../../../server/hosts/request-auth";
import { runEventService } from "../../../../../server/run-events";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const events = await runEventService.listEvents(id);

  return NextResponse.json({ events });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireHostToken(request);
    const [{ id }, input] = await Promise.all([
      context.params,
      runEventIngestRequestSchema.parseAsync(await request.json())
    ]);

    await runEventService.ingestEvent(id, input);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to ingest run event" },
      { status: error instanceof Error && error.message === "Invalid host token" ? 401 : 400 }
    );
  }
}

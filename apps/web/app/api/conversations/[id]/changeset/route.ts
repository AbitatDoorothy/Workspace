import { NextResponse } from "next/server";
import { z } from "zod";

import { reviewService } from "../../../../../server/reviews";

const changeSetRequestSchema = z.object({
  filesChanged: z.array(z.string().min(1)),
  diffText: z.string(),
  summary: z.string().min(1)
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const changeSet = await reviewService.getChangeSet(id);

  return NextResponse.json({ changeSet });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, input] = await Promise.all([
      context.params,
      changeSetRequestSchema.parseAsync(await request.json())
    ]);

    await reviewService.storeChangeSet(id, input);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to store changeset" },
      { status: 400 }
    );
  }
}

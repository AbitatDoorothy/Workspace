import { codexModelOptionsResponseSchema } from "@abitat/shared";
import { NextResponse } from "next/server";

import { codexAppService } from "../../../../../server/codex-app";
import { requireMobileActor } from "../../../../../server/mobile/request-auth";

export async function GET(request: Request) {
  try {
    await requireMobileActor(request);
    const models = await codexAppService.listModelOptions();

    return NextResponse.json(codexModelOptionsResponseSchema.parse({ models }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list Codex models" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

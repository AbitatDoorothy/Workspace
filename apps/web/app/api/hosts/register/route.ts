import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequestCliAccountContext } from "../../../../server/auth/cli-request-auth";
import { hostService } from "../../../../server/hosts";

const requestSchema = z.object({
  machineName: z.string().min(1),
  platform: z.string().min(1).optional()
});

export async function POST(request: Request) {
  try {
    const [account, input] = await Promise.all([
      getRequestCliAccountContext(request),
      request.json().then((body) => requestSchema.parse(body))
    ]);

    return NextResponse.json(
      await hostService.registerHost({
        userId: account.userId,
        workspaceId: account.workspaceId,
        machineName: input.machineName,
        platform: input.platform
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to register host" },
      { status: 400 }
    );
  }
}

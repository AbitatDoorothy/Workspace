import { NextResponse } from "next/server";
import { z } from "zod";

import { agentService } from "../../../server/agents";
import { createPublicRedirectUrl } from "../../../server/auth/session";

const agentRequestSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  instructions: z.string().min(1),
  model: z.string().min(1).default("mock-model"),
  runtime: z.string().min(1).default("mock"),
  allowedTools: z.array(z.string()).default(["git", "node"]),
  createdByUserId: z.string().min(1).default("user_demo")
});

export async function POST(request: Request) {
  try {
    const body = await parseRequest(request);
    const agent = await agentService.createAgent(agentRequestSchema.parse(body));

    if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(createPublicRedirectUrl(request, "/agents"), 303);
    }

    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create agent" },
      { status: 400 }
    );
  }
}

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = Object.fromEntries(await request.formData());
    return {
      ...form,
      allowedTools: String(form.allowedTools ?? "")
        .split(",")
        .map((tool) => tool.trim())
        .filter(Boolean)
    };
  }

  return request.json();
}

import type { Prisma, PrismaClient } from "@prisma/client";
import type { Runtime } from "@abitat_reece/shared";

import { prisma } from "../db/client";
import { createAgentService, type AgentRecord } from "./agent-service";

export const agentService = createAgentService(createPrismaAgentDb(prisma));

function createPrismaAgentDb(db: PrismaClient) {
  return {
    agent: {
      async create(args: { data: Prisma.AgentUncheckedCreateInput }) {
        return normalizeAgent(await db.agent.create({ data: args.data }));
      },
      async findMany(args?: { where?: Prisma.AgentWhereInput }) {
        const agents = await db.agent.findMany({
          where: args?.where,
          orderBy: { createdAt: "desc" }
        });

        return agents.map(normalizeAgent);
      }
    }
  };
}

function normalizeAgent(agent: {
  id: string;
  projectId: string;
  name: string;
  role: string;
  instructions: string;
  model: string;
  runtime: Runtime;
  allowedToolsJson: Prisma.JsonValue;
  createdByUserId: string;
}): AgentRecord {
  return {
    id: agent.id,
    projectId: agent.projectId,
    name: agent.name,
    role: agent.role,
    instructions: agent.instructions,
    model: agent.model,
    runtime: agent.runtime,
    allowedToolsJson: Array.isArray(agent.allowedToolsJson)
      ? agent.allowedToolsJson.filter((tool): tool is string => typeof tool === "string")
      : [],
    createdByUserId: agent.createdByUserId
  };
}

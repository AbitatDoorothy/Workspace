import { randomBytes } from "node:crypto";

import { runtimeSchema, type HostTool, type Runtime } from "@abitat/shared";

interface AgentCreateInput {
  projectId: string;
  name: string;
  role: string;
  instructions: string;
  model: string;
  runtime: string;
  allowedTools: string[];
  createdByUserId: string;
}

export interface AgentRecord {
  id: string;
  projectId: string;
  name: string;
  role: string;
  instructions: string;
  model: string;
  runtime: Runtime;
  allowedToolsJson: string[];
  createdByUserId: string;
}

interface AgentDb {
  agent: {
    create(args: { data: AgentRecord }): Promise<AgentRecord>;
    findMany(args?: { where?: { projectId?: string } }): Promise<AgentRecord[]>;
  };
}

export function runtimeChoicesFromTools(tools: Pick<HostTool, "name" | "installed">[]) {
  const choices: Runtime[] = ["mock"];

  if (tools.some((tool) => tool.name === "codex" && tool.installed)) {
    choices.push("codex");
  }

  if (tools.some((tool) => tool.name === "claude" && tool.installed)) {
    choices.push("claude");
  }

  return choices;
}

export function runtimeAvailabilityWarning(
  runtime: Runtime,
  tools: Pick<HostTool, "name" | "installed">[]
) {
  if (runtime === "mock" || tools.some((tool) => tool.name === runtime && tool.installed)) {
    return null;
  }

  return `${runtime === "codex" ? "Codex" : "Claude"} CLI is unavailable on the host.`;
}

export function createAgentService(db: AgentDb) {
  return {
    async createAgent(input: AgentCreateInput) {
      const parsedRuntime = runtimeSchema.safeParse(input.runtime);

      if (!parsedRuntime.success || input.instructions.trim().length === 0) {
        throw new Error("Invalid agent configuration");
      }

      const agent: AgentRecord = {
        id: `agent_${randomBytes(8).toString("hex")}`,
        projectId: input.projectId,
        name: input.name,
        role: input.role,
        instructions: input.instructions,
        model: input.model,
        runtime: parsedRuntime.data,
        allowedToolsJson: input.allowedTools,
        createdByUserId: input.createdByUserId
      };

      return db.agent.create({ data: agent });
    },

    listAgents(projectId?: string) {
      return db.agent.findMany(projectId ? { where: { projectId } } : undefined);
    }
  };
}

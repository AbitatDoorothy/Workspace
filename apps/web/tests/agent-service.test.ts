import { describe, expect, it } from "vitest";

import {
  createAgentService,
  preferredRuntimeFromTools,
  runtimeAvailabilityWarning,
  runtimeChoicesFromTools
} from "../server/agents/agent-service";

interface TestAgent {
  id: string;
  projectId: string;
  name: string;
  role: string;
  instructions: string;
  model: string;
  runtime: "mock" | "codex" | "claude";
  allowedToolsJson: string[];
  createdByUserId: string;
}

type CreateArgs<TRecord> = { data: TRecord };
type FindManyArgs = { where?: { projectId?: string } };

function createAgentDb() {
  const agents = new Map<string, TestAgent>();

  return {
    agent: {
      create: async ({ data }: CreateArgs<TestAgent>) => {
        agents.set(data.id, data);
        return data;
      },
      findMany: async ({ where }: FindManyArgs = {}) =>
        Array.from(agents.values()).filter((agent) =>
          Object.entries(where ?? {}).every(
            ([key, value]) => agent[key as keyof TestAgent] === value
          )
        )
    }
  };
}

describe("agent service", () => {
  it("always includes mock and only includes installed real runtimes", () => {
    expect(
      runtimeChoicesFromTools([
        { name: "codex", installed: true },
        { name: "claude", installed: false }
      ])
    ).toEqual(["mock", "codex"]);
  });

  it("prefers Codex for newly created agents when it is available", () => {
    expect(
      preferredRuntimeFromTools([
        { name: "codex", installed: true },
        { name: "claude", installed: true }
      ])
    ).toBe("codex");
    expect(preferredRuntimeFromTools([{ name: "claude", installed: true }])).toBe("claude");
    expect(preferredRuntimeFromTools([])).toBe("mock");
  });

  it("warns when a real runtime is selected but unavailable", () => {
    expect(runtimeAvailabilityWarning("mock", [])).toBeNull();
    expect(runtimeAvailabilityWarning("codex", [{ name: "codex", installed: false }])).toBe(
      "Codex CLI is unavailable on the host."
    );
    expect(runtimeAvailabilityWarning("claude", [{ name: "claude", installed: true }])).toBeNull();
  });

  it("creates project agents with validated instructions and runtime", async () => {
    const service = createAgentService(createAgentDb());

    const agent = await service.createAgent({
      projectId: "project_demo",
      name: "Mock Agent",
      role: "Builder",
      instructions: "Use the mock runtime.",
      model: "mock-model",
      runtime: "mock",
      allowedTools: ["git", "node"],
      createdByUserId: "user_demo"
    });

    expect(agent).toMatchObject({
      projectId: "project_demo",
      runtime: "mock",
      allowedToolsJson: ["git", "node"]
    });
    await expect(
      service.createAgent({
        projectId: "project_demo",
        name: "Bad Agent",
        role: "Builder",
        instructions: "",
        model: "mock-model",
        runtime: "gpt-999",
        allowedTools: [],
        createdByUserId: "user_demo"
      })
    ).rejects.toThrow("Invalid agent configuration");
  });
});

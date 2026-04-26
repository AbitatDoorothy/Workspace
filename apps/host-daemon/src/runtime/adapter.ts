import type { RunEventType, Runtime } from "@abitat/shared";

export interface RuntimeEvent {
  type: Extract<RunEventType, "error" | "status" | "stdout" | "stderr">;
  content: string;
}

export interface RuntimeRunInput {
  worktreePath: string;
  prompt: string;
  model: string;
  instructions: string;
  allowedTools?: string[];
}

export interface RuntimeAvailability {
  installed: boolean;
  version?: string;
  path?: string;
  reason?: string;
}

export interface RuntimeAdapter {
  name: Runtime;
  isAvailable(): Promise<RuntimeAvailability>;
  run(input: RuntimeRunInput, emit: (event: RuntimeEvent) => Promise<void>): Promise<void>;
}

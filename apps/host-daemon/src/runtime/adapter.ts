import type { RunEventType } from "@abitat/shared";

export interface RuntimeEvent {
  type: Extract<RunEventType, "status" | "stdout" | "stderr">;
  content: string;
}

export interface RuntimeRunInput {
  worktreePath: string;
  prompt: string;
  model: string;
  instructions: string;
}

export interface RuntimeAdapter {
  run(input: RuntimeRunInput, emit: (event: RuntimeEvent) => Promise<void>): Promise<void>;
}

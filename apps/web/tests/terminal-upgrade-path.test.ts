import { describe, expect, it } from "vitest";

import { isTerminalUpgradePath } from "../server/terminal/upgrade-path";

describe("terminal upgrade path", () => {
  it("detects terminal websocket upgrade paths with the WHATWG URL parser", () => {
    expect(isTerminalUpgradePath("/api/conversations/conversation_demo/terminal")).toBe(true);
    expect(isTerminalUpgradePath("/api/conversations/conversation_demo/terminal?role=daemon")).toBe(
      true
    );
    expect(isTerminalUpgradePath("http://localhost:3000/api/conversations/demo/terminal")).toBe(
      true
    );
    expect(isTerminalUpgradePath("/api/conversations/demo/events")).toBe(false);
  });
});

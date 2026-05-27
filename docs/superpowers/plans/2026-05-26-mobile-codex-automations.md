# Mobile Codex Automations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a paired iPhone view, create, and edit local Codex automations from Abitat's dashboard without hosted services.

**Architecture:** Add a host-daemon automation service that reads and writes `~/.codex/automations/<id>/automation.toml` using a deliberately small TOML subset matching Codex automation files. Expose the service through authenticated `/api/mobile/codex/automations` routes, then add an iOS Automations route reachable from the existing dashboard. Keep v1 focused on local/cron automations and preserve unknown TOML fields when editing existing files.

**Tech Stack:** Node 22, TypeScript, Vitest, React Native/Expo, existing Abitat local-control HTTP API.

---

### Task 1: Host Automation File Service

**Files:**
- Create: `/Users/reece/Desktop/Abitat_Workspace/apps/host-daemon/src/local-control/automations.ts`
- Test: `/Users/reece/Desktop/Abitat_Workspace/apps/host-daemon/tests/local-control-automations.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  createCodexAutomation,
  listCodexAutomations,
  updateCodexAutomation
} from "../src/local-control/automations";

describe("local Codex automations", () => {
  it("lists Codex automation TOML files with editable fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "abitat-automations-"));
    try {
      await createCodexAutomation({ rootDir: root }, {
        kind: "cron",
        name: "Daily Review",
        prompt: "Review yesterday's Codex work.",
        status: "ACTIVE",
        rrule: "FREQ=DAILY;INTERVAL=1",
        model: "gpt-5",
        reasoningEffort: "medium",
        executionEnvironment: "local",
        cwds: ["/Users/reece/Desktop/Abitat_Workspace"]
      });

      const automations = await listCodexAutomations({ rootDir: root });

      expect(automations).toEqual([
        expect.objectContaining({
          kind: "cron",
          name: "Daily Review",
          prompt: "Review yesterday's Codex work.",
          status: "ACTIVE",
          rrule: "FREQ=DAILY;INTERVAL=1",
          model: "gpt-5",
          reasoningEffort: "medium",
          executionEnvironment: "local",
          cwds: ["/Users/reece/Desktop/Abitat_Workspace"]
        })
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("updates an existing automation without changing its id", async () => {
    const root = await mkdtemp(join(tmpdir(), "abitat-automations-"));
    try {
      const created = await createCodexAutomation({ rootDir: root }, {
        kind: "cron",
        name: "Daily Review",
        prompt: "Review yesterday's Codex work.",
        status: "ACTIVE",
        rrule: "FREQ=DAILY;INTERVAL=1",
        model: "gpt-5",
        reasoningEffort: "medium",
        executionEnvironment: "local",
        cwds: ["/Users/reece/Desktop/Abitat_Workspace"]
      });

      const updated = await updateCodexAutomation({ rootDir: root }, created.id, {
        name: "Paused Review",
        status: "PAUSED",
        cwds: []
      });

      expect(updated).toMatchObject({
        id: created.id,
        name: "Paused Review",
        status: "PAUSED",
        cwds: []
      });
      expect(await readFile(join(root, created.id, "automation.toml"), "utf8")).toContain(
        'status = "PAUSED"'
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run red test**

Run: `pnpm --filter @abitat_reece/host-daemon test tests/local-control-automations.test.ts`

Expected: fail because `../src/local-control/automations` does not exist.

- [ ] **Step 3: Implement service**

Create an `automations.ts` module with exported `listCodexAutomations`, `createCodexAutomation`, and `updateCodexAutomation`. Use atomic writes via temp file + rename. Parse only top-level strings, numbers, and string arrays used by Codex automation TOML. Normalize snake_case TOML keys to camelCase API fields.

- [ ] **Step 4: Run green test**

Run: `pnpm --filter @abitat_reece/host-daemon test tests/local-control-automations.test.ts`

Expected: pass.

### Task 2: Authenticated Mobile API

**Files:**
- Modify: `/Users/reece/Desktop/Abitat_Workspace/apps/host-daemon/src/local-control/server.ts`
- Test: `/Users/reece/Desktop/Abitat_Workspace/apps/host-daemon/tests/local-control-server.test.ts`

- [ ] **Step 1: Write failing server tests**

Add tests that start the local-control server with a temp automation root and assert:

```ts
const listResponse = await requestJson(server.endpoint, "/api/mobile/codex/automations", {
  token: clientToken
});
expect(listResponse.automations).toHaveLength(1);

const createResponse = await requestJson(server.endpoint, "/api/mobile/codex/automations", {
  method: "POST",
  token: clientToken,
  body: {
    kind: "cron",
    name: "Phone Automation",
    prompt: "Run from phone",
    status: "ACTIVE",
    rrule: "FREQ=HOURLY;INTERVAL=8",
    model: "gpt-5",
    reasoningEffort: "medium",
    executionEnvironment: "local",
    cwds: ["/Users/reece/Desktop/Abitat_Workspace"]
  }
});
expect(createResponse.automation.name).toBe("Phone Automation");
```

- [ ] **Step 2: Run red server tests**

Run: `pnpm --filter @abitat_reece/host-daemon test tests/local-control-server.test.ts`

Expected: fail with `Not found` for the new routes.

- [ ] **Step 3: Add routes**

Add authenticated routes:
- `GET /api/mobile/codex/automations`
- `POST /api/mobile/codex/automations`
- `PATCH /api/mobile/codex/automations/:automationId`

Validate required strings with existing helpers and return `{ automations }` or `{ automation }`.

- [ ] **Step 4: Run green server tests**

Run: `pnpm --filter @abitat_reece/host-daemon test tests/local-control-server.test.ts`

Expected: pass.

### Task 3: Mobile API Types And Client

**Files:**
- Modify: `/Users/reece/Desktop/Abitat_Workspace/apps/ios/src/types.ts`
- Modify: `/Users/reece/Desktop/Abitat_Workspace/apps/ios/src/api/client.ts`
- Modify: `/Users/reece/Desktop/Abitat_Workspace/apps/ios/scripts/validate-ios-app.mjs`

- [ ] **Step 1: Add validator expectations**

Add validation strings for `CodexAutomationSummary`, `listCodexAutomations`, `createCodexAutomation`, and `updateCodexAutomation`.

- [ ] **Step 2: Run red iOS validation**

Run: `pnpm --filter abitat-ios test`

Expected: fail because the client and types are missing.

- [ ] **Step 3: Add types and client methods**

Add mobile-facing automation types and API client methods for list/create/update.

- [ ] **Step 4: Run green iOS validation**

Run: `pnpm --filter abitat-ios test`

Expected: pass.

### Task 4: Mobile Automations Screen

**Files:**
- Create: `/Users/reece/Desktop/Abitat_Workspace/apps/ios/src/screens/AutomationsScreen.tsx`
- Modify: `/Users/reece/Desktop/Abitat_Workspace/apps/ios/src/screens/SettingsScreen.tsx`
- Modify: `/Users/reece/Desktop/Abitat_Workspace/apps/ios/src/App.tsx`
- Modify: `/Users/reece/Desktop/Abitat_Workspace/apps/ios/src/types.ts`
- Modify: `/Users/reece/Desktop/Abitat_Workspace/apps/ios/scripts/validate-ios-app.mjs`

- [ ] **Step 1: Add validator expectations**

Validate the dashboard button text `AUTOMATIONS`, route name `"automations"`, `AutomationsScreen`, and form actions `SAVE AUTOMATION`, `NEW AUTOMATION`, `ACTIVE`, `PAUSED`.

- [ ] **Step 2: Run red iOS validation**

Run: `pnpm --filter abitat-ios test`

Expected: fail because the screen and route do not exist.

- [ ] **Step 3: Implement screen and route**

Add a dense, dashboard-style screen that lists automations, lets the user select one, edit core fields, pause/resume, and create a new cron/local automation. Keep inputs scrollable and avoid touching current projects/conversation behavior.

- [ ] **Step 4: Run green iOS validation**

Run: `pnpm --filter abitat-ios test`

Expected: pass.

### Task 5: Final Verification

**Files:**
- All modified files.

- [ ] **Step 1: Run host tests**

Run: `pnpm --filter @abitat_reece/host-daemon test`

Expected: all tests pass.

- [ ] **Step 2: Run host typecheck**

Run: `pnpm --filter @abitat_reece/host-daemon typecheck`

Expected: pass.

- [ ] **Step 3: Run iOS validation and typecheck**

Run:
```bash
pnpm --filter abitat-ios test
pnpm --filter abitat-ios typecheck
```

Expected: both pass.

- [ ] **Step 4: Check diff hygiene**

Run: `git diff --check`

Expected: no whitespace errors.

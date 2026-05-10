# Mobile Command Queue And Steer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let iPhone users send additional Codex commands while a Mac turn is running, queue normal sends, and steer active Codex turns immediately.

**Architecture:** Keep Codex execution owned by the Mac. The host daemon stores an in-memory per-thread FIFO queue for normal mobile sends that arrive while the thread is busy, drains the queue when Codex becomes idle, and uses Codex app-server `thread/inject_items` for steer sends into active turns. The iOS chat composer remains enabled during running states and exposes separate queued send and steer actions.

**Tech Stack:** TypeScript host daemon, Codex app JSON-RPC bridge, React Native/Expo iOS app, Vitest, iOS validation script.

---

### Task 1: Host Queue And Steer API

**Files:**
- Modify: `apps/host-daemon/src/local-control/server.ts`
- Modify: `apps/host-daemon/src/local-control/codex-bridge.ts`
- Test: `apps/host-daemon/tests/local-control-codex-bridge-queue.test.ts`

- [x] Add `delivery?: "queue" | "steer"` to local continuation input.
- [x] Add a failing Vitest case proving a busy thread returns `queued` and starts the queued turn after the running turn completes.
- [x] Add a failing Vitest case proving `delivery: "steer"` calls Codex app-server `thread/inject_items` while the current turn is still active.
- [x] Implement per-thread queue storage and queue drain polling in `createLocalCodexBridge`.
- [x] Add Codex app client `injectItems(threadId, items)` support.
- [x] Pass `delivery` through `/api/mobile/conversations/:conversationId/continue`.
- [x] Run host-daemon tests and typecheck.

### Task 2: iOS Queue And Steer UI

**Files:**
- Modify: `apps/ios/src/api/client.ts`
- Modify: `apps/ios/src/screens/ConversationScreen.tsx`
- Modify: `apps/ios/scripts/validate-ios-app.mjs`

- [x] Add `delivery?: "queue" | "steer"` to `ApiClient.continueConversation`.
- [x] Update the validation script first so it fails until queue/steer markers exist in the iOS code.
- [x] Allow the send action while Codex is running; queued sends should use `delivery: "queue"` and display queued local message state.
- [x] Add a compact `Steer` action that sends the current prompt with `delivery: "steer"` for active turns.
- [x] Keep `Git` shortcut sendable while running by using the normal queue path.
- [x] Run iOS validation and typecheck.

### Task 3: Final Verification

- [x] Run `pnpm --filter @abitat_reece/host-daemon test`.
- [x] Run `pnpm --filter @abitat_reece/host-daemon typecheck`.
- [x] Run `pnpm --filter abitat-ios test`.
- [x] Run `pnpm --filter abitat-ios typecheck`.
- [x] Run Prettier check on changed files.
- [x] Run `git diff --check`.
- [x] Commit with `feat: add mobile command queue and steer`.

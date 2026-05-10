# Mobile Status Sync Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ensure mobile displays `running` in real time when the paired Mac desktop Codex thread is actively running, instead of stale `cancelled` or other terminal states.

**Architecture:** Fix the host-daemon status mapper at the Codex app boundary. The Mac-local mobile API should treat active Codex thread status as authoritative for live execution and only surface interrupted/cancelled once the thread is no longer actively running. The iOS app continues polling the project conversation endpoint, but validation guards the real-time status refresh path.

**Tech Stack:** TypeScript host daemon, Codex app bridge status mapping, React Native/Expo validation, Vitest.

---

### Task 1: Reproduce Status Mapping Bug

**Files:**
- Test: `apps/host-daemon/tests/local-control-codex-status.test.ts`

- [x] Add a failing Vitest case for an active desktop thread whose latest persisted turn is interrupted but whose thread status is still active.
- [x] Assert `listProjectConversations()` returns `running`, not `cancelled`.
- [x] Assert `listCompletionStates()` reports `status: "running"`, `failed: false`, and `isComplete: false`.
- [x] Run the focused host-daemon test and confirm it fails for the expected `cancelled`/failed status.

### Task 2: Fix Host Status Mapping

**Files:**
- Modify: `apps/host-daemon/src/local-control/codex-bridge.ts`

- [x] Change `codexThreadToConversationStatus()` so a currently active non-terminal thread maps to `running` before stale interrupted turn checks.
- [x] Keep genuinely interrupted inactive threads mapped to `cancelled`.
- [x] Keep failed turns mapped to `failed`.
- [x] Update completion-state failure detection so active running threads are not marked failed because of stale interrupted turn data.
- [x] Run the focused host-daemon test and confirm it passes.

### Task 3: Guard iOS Status Refresh

**Files:**
- Modify: `apps/ios/scripts/validate-ios-app.mjs`

- [x] Add validation checks that `ConversationScreen` still polls `api.listConversations`, stores `latestStatusRef`, calls `setStatus(nextStatus)`, and triggers message refresh through `shouldForceMessageRefreshAfterStatusPoll`.
- [x] Run iOS validation.

### Task 4: Final Verification

- [x] Run `pnpm --filter @abitat_reece/host-daemon test`.
- [x] Run `pnpm --filter @abitat_reece/host-daemon typecheck`.
- [x] Run `pnpm --filter abitat-ios test`.
- [x] Run `pnpm --filter abitat-ios typecheck`.
- [x] Run Prettier check on changed files.
- [x] Run `git diff --check`.
- [x] Commit with `fix: correct mobile running status sync`.

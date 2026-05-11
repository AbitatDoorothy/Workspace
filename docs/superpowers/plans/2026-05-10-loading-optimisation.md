# Loading Optimisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project, conversation, and chat history loading feel faster on the iPhone.

**Architecture:** Keep mobile lists warm across route changes and avoid expensive repeated Codex thread reads on the Mac. Use stale-while-refresh UI behavior on iOS and short-lived host-side caching for Codex thread list calls.

**Tech Stack:** React Native, TypeScript, host-daemon Codex app bridge, Vitest.

---

### Task 1: iOS Warm List State

**Files:**
- Modify: `apps/ios/src/App.tsx`
- Modify: `apps/ios/src/screens/ProjectsScreen.tsx`
- Modify: `apps/ios/src/screens/ProjectDetailScreen.tsx`
- Modify: `apps/ios/scripts/validate-ios-app.mjs`

- [ ] Add parent-level project and conversation caches in `App.tsx`.
- [ ] Pass cached projects into `ProjectsScreen`, and pass cache update callbacks back to `App.tsx`.
- [ ] Pass cached conversations into `ProjectDetailScreen`, and pass cache update callbacks back to `App.tsx`.
- [ ] Keep old content visible while refreshing instead of remounting into empty lists.
- [ ] Add validation checks for `initialProjects`, `initialConversations`, and cache update callbacks.

### Task 2: Host Codex Read Reduction

**Files:**
- Modify: `apps/host-daemon/src/local-control/codex-bridge.ts`
- Modify: `apps/host-daemon/tests/local-control-server.test.ts`

- [ ] Add a short TTL cache around Codex `thread/list` calls keyed by params.
- [ ] Stop reading every thread with turns for `listProjectConversations`; use thread-list summaries for the list page.
- [ ] Keep full `thread/read` only for opening an actual conversation and for completion-state checks.
- [ ] Add focused tests that conversation listing does not require full message history.

### Task 3: Verification

- [ ] Run `pnpm --filter abitat-ios test`.
- [ ] Run `pnpm --filter abitat-ios typecheck`.
- [ ] Run `pnpm --filter @abitat_reece/host-daemon test`.
- [ ] Run `pnpm --filter @abitat_reece/host-daemon typecheck`.
- [ ] Run Prettier and `git diff --check`.


# Abitat Mac Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real MacBook desktop app that replaces daily dependence on Codex Desktop while preserving Abitat's existing local-first phone control.

**Architecture:** Add an Electron app that runs on the Mac and owns the same local-control server, relay connection, pairing store, Codex bridge, diagnostics, notifications, token usage, automations, and remote-control manager already used by `abitat iphone`. The Electron main process is the trusted local authority; the renderer is a desktop UI over typed IPC and the paired phone continues to control only the explicitly paired Mac through the existing authenticated local mobile API.

**Tech Stack:** Electron main/preload, React + Vite renderer, TypeScript, Vitest, existing `@abitat_reece/host-daemon` local-control modules, existing `@abitat_reece/shared` schemas, local Codex CLI `app-server` via `stdio://`.

---

## Current Project Context

- `apps/host-daemon` already owns local-first Mac authority: pairing state in `~/Library/Application Support/Abitat/local-control-state.json`, mobile auth, relay client, Codex bridge, queue/steer, generated files, diagnostics log, token usage, push notifications, automations, and whole-Mac remote control.
- `apps/cli` starts that local authority with `abitat iphone`; the Mac app should make that command unnecessary for daily use.
- `apps/ios` is already paired to a Mac endpoint/token and calls the Mac-local mobile API for projects, chats, threads, messages, queue/steer, generated files, diagnostics, token usage, automations, notifications, and remote control.
- `apps/web` remains hosted/dashboard support and legacy development surface. Core desktop and phone control must not depend on its database.
- There is existing uncommitted work for local automations in host-daemon and iOS. The Mac app will integrate with those files without reverting them.

## File Structure

- Create `apps/mac-app/package.json`: desktop app package, scripts, Electron/Vite/React dependencies, packaging metadata.
- Create `apps/mac-app/tsconfig.json`, `tsconfig.renderer.json`, `vite.config.ts`, `vitest.config.ts`: compile main/preload and renderer with existing monorepo TypeScript style.
- Create `apps/mac-app/index.html`: renderer entry.
- Create `apps/mac-app/src/main/runtime.ts`: start/stop local control server, relay, Codex bridge, notification poller, pairing payloads, and desktop API facade.
- Create `apps/mac-app/src/main/ipc.ts`: Electron IPC handlers with a narrow allowlist.
- Create `apps/mac-app/src/main/main.ts`: Electron lifecycle and BrowserWindow setup.
- Create `apps/mac-app/src/preload.ts`: typed `window.abitat` bridge.
- Create `apps/mac-app/src/shared/types.ts`: desktop IPC contract types used by main, preload, renderer, and tests.
- Create `apps/mac-app/src/renderer/App.tsx`, `main.tsx`, `styles.css`, and small UI modules: desktop projects/chats/messages, right-side operations rail, automations editor, pairing panel, diagnostics, generated files, and token usage.
- Create `apps/mac-app/src/renderer/view-model.ts`: pure UI helpers for status colors, sorting, formatting, and message previews.
- Create `apps/mac-app/tests/runtime.test.ts` and `apps/mac-app/tests/view-model.test.ts`: test first for desktop API behavior and UI helpers.
- Modify `apps/host-daemon/src/local-control/codex-bridge.ts` and `apps/web/server/codex-app/codex-app-client.ts`: default to the `codex` CLI binary instead of `/Applications/Codex.app/.../codex`, while preserving `CODEX_APP_BINARY`.
- Modify root `package.json` and docs only if needed for discoverability.

## Data Flow

1. Mac app launches.
2. Electron main process creates one `LocalControlStore`, one `LocalCodexBridge`, one diagnostics logger, one local-control server, and one relay client.
3. Renderer uses IPC to call the main process. It does not receive filesystem or shell access.
4. Phone pairs by scanning a Mac-app-generated payload. The Mac app uses the same store and same `createPairing` flow as `abitat iphone`.
5. Phone calls continue through the existing local mobile API with Bearer token auth or relay envelopes. The server validates the paired phone before touching Codex or local files.
6. Renderer and phone share the same Codex bridge instance, so queue/steer state, running status, completion polling, generated file lists, automations, token usage, and diagnostics are consistent.

## Local-First Sync Model

- Mac remains the source of truth for Codex projects, chats, threads, messages, generated files, logs, token usage, automations, and remote-control state.
- Phone stores only paired Mac endpoint/token plus cache. It cannot control another Mac without that Mac creating and consuming a pairing payload.
- Renderer is local to the paired Mac and talks through IPC, not hosted accounts.
- Relay remains packet routing only. It never owns projects, conversations, pairings, tokens, files, or automations.
- If the Mac app is closed, the phone cannot control Codex unless another Abitat local-control process is running.

## UI/UX

- First screen is the usable desktop control surface, not a landing page.
- Layout: compact left project/thread sidebar, central chat surface, right operational rail.
- Visual style: black/dark Abitat feel, thin borders, small status dots, restrained uppercase labels, icon buttons, no marketing hero.
- Daily workflows:
  - scan projects and chats quickly,
  - open or start threads,
  - send prompts with model/effort and queue/steer mode,
  - monitor running/queued status,
  - inspect generated files and reveal them in Finder,
  - view token usage,
  - open diagnostics logs,
  - create/edit automations,
  - generate phone pairing payloads and see remote-control readiness.

## Testing

- Runtime test verifies desktop API facade calls the same local Codex bridge methods and creates a phone pairing payload from the local store.
- Runtime test verifies generated files and token usage are surfaced without hosted services.
- View-model test verifies status ordering/tones and formatting used by the desktop UI.
- Existing host-daemon tests continue to cover pairing auth, relay, queue/steer, generated files, logs, token usage, automations, notifications, and remote control.
- Verification commands:
  - `pnpm --filter @abitat_reece/mac-app test`
  - `pnpm --filter @abitat_reece/mac-app typecheck`
  - `pnpm --filter @abitat_reece/mac-app build`
  - targeted host-daemon tests for Codex bridge/server behavior

## Packaging

- Development: `pnpm dev:mac` or `pnpm --filter @abitat_reece/mac-app dev`.
- Local production build: `pnpm mac:build` or `pnpm --filter @abitat_reece/mac-app build`.
- Local production launch from built assets: `pnpm mac:start` or `pnpm --filter @abitat_reece/mac-app start`.
- Later release path: add signed/notarized DMG or zip packaging once Apple credentials are available.
- The Mac app should prefer `codex` from PATH and keep `CODEX_APP_BINARY` as an escape hatch for custom installations.

## Migration Steps

1. Install/update Codex CLI and sign in with `codex login`.
2. Start Abitat Mac app instead of Codex Desktop and `abitat iphone`.
3. Pair the iPhone from the Mac app pairing panel.
4. Confirm projects/chats/messages match Codex local state.
5. Use Mac app and iPhone interchangeably for prompts, queue/steer, files, logs, token usage, automations, notifications, and remote-control entry points.

## Implementation Tasks

### Task 1: Desktop Contracts And Tests

**Files:**
- Create: `apps/mac-app/src/shared/types.ts`
- Create: `apps/mac-app/src/main/runtime.ts`
- Create: `apps/mac-app/tests/runtime.test.ts`
- Create: `apps/mac-app/tests/view-model.test.ts`

- [x] Write failing tests for the desktop API facade and view-model helpers.
- [x] Implement typed desktop API methods over injectable Codex/store dependencies.
- [x] Run `pnpm --filter @abitat_reece/mac-app test` and make the new tests pass.

### Task 2: Electron Shell

**Files:**
- Create: `apps/mac-app/package.json`
- Create: `apps/mac-app/tsconfig.json`
- Create: `apps/mac-app/tsconfig.renderer.json`
- Create: `apps/mac-app/vite.config.ts`
- Create: `apps/mac-app/vitest.config.ts`
- Create: `apps/mac-app/src/main/main.ts`
- Create: `apps/mac-app/src/main/ipc.ts`
- Create: `apps/mac-app/src/preload.ts`

- [x] Add Electron/Vite/React app package.
- [x] Wire main process startup, secure preload bridge, and IPC allowlist.
- [x] Run typecheck for main/preload.

### Task 3: Desktop UI

**Files:**
- Create: `apps/mac-app/index.html`
- Create: `apps/mac-app/src/renderer/main.tsx`
- Create: `apps/mac-app/src/renderer/App.tsx`
- Create: `apps/mac-app/src/renderer/styles.css`
- Create: `apps/mac-app/src/renderer/view-model.ts`

- [x] Build project/thread sidebar, chat panel, prompt composer, queue/steer controls, model/effort controls.
- [x] Build right rail for running status, generated files, logs, token usage, automations, pairing, notifications, and remote-control readiness.
- [x] Verify the UI builds through Vite.

### Task 4: Remove Codex Desktop Binary Default

**Files:**
- Modify: `apps/host-daemon/src/local-control/codex-bridge.ts`
- Modify: `apps/web/server/codex-app/codex-app-client.ts`

- [x] Change default Codex binary from the Codex Desktop app resource path to `codex`.
- [x] Keep `CODEX_APP_BINARY` override.
- [x] Update user-facing error text to mention Codex CLI.

### Task 5: Verification And Startup

**Files:**
- Modify as needed only for compile/test failures.

- [x] Run package tests and typechecks.
- [x] Run host-daemon targeted tests touched by the implementation.
- [x] Build the Mac app.
- [x] Start the Mac app production command and verify the Electron window renders.

## Self-Review

- No hosted database is introduced for core desktop/phone control.
- Phone pairing remains explicit and per-Mac.
- Renderer cannot directly access shell/filesystem except through specific IPC actions.
- Existing CLI/iOS behavior remains in place.
- Uncommitted automations work is integrated, not reverted.

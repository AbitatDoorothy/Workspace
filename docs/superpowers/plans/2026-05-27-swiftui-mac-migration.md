# SwiftUI Mac Migration Plan

## Goal

Replace Electron as the primary Abitat Mac desktop UI with a native SwiftUI app while keeping the existing TypeScript local-control backend as the Mac authority. The iPhone app must continue to pair with and control the same Mac-local backend without API or behavior changes.

## Architecture

- Native app: `apps/mac-native`, a Swift Package executable using SwiftUI/AppKit.
- Backend helper: a new `abitat-host desktop` command in `apps/host-daemon`.
- Phone server: unchanged `startLocalControlServer` API and pairing/auth behavior.
- Desktop helper API: a loopback-only HTTP API on `127.0.0.1` for SwiftUI. It wraps the same local Codex bridge, store, relay client, diagnostics, token usage, generated files, automations, and notification poller.
- Codex control: unchanged `codex app-server --listen stdio://` bridge.

```text
SwiftUI Mac app
  -> launches abitat-host desktop helper
  -> calls http://127.0.0.1:<desktop-port>/api/desktop/*

iPhone app
  -> paired endpoint or relay
  -> existing /api/mobile/* local-control server
  -> same Codex bridge and local state
```

## Data Flow

1. `pnpm mac:start` builds the host daemon and launches the SwiftUI app.
2. SwiftUI starts the Node helper process unless `ABITAT_DESKTOP_BACKEND_URL` points to an already-running helper.
3. The helper starts:
   - local-control server for the phone,
   - relay client,
   - Codex bridge,
   - completion notifier,
   - desktop loopback API.
4. SwiftUI polls the desktop API for projects, conversations, messages, completion state, generated files, token usage, automations, and diagnostics.
5. Phone pairing from SwiftUI creates the same pairing payload as the current local-control store.
6. The phone consumes pairing and continues using `/api/mobile/*` with Bearer-token auth.

## Phone Compatibility Rules

- Do not change pairing payload format.
- Do not change `/api/mobile/*` routes or JSON shapes.
- Do not change relay encryption/session behavior.
- Do not change paired device auth.
- Keep the backend alive while the SwiftUI app is open so paired phone control works.

## Low-RAM Strategy

- Remove Electron/Chromium from the primary runtime path.
- SwiftUI renders the UI natively.
- Node remains as a helper process only for local-control/backend work.
- Helper stays single-process and reuses one Codex bridge, one store, one relay client.
- Polling intervals stay modest and SwiftUI refreshes only the selected conversation in detail.

## File Changes

- Add `apps/host-daemon/src/local-control/desktop-server.ts`.
- Modify `apps/host-daemon/src/cli/index.ts` with `desktop` command.
- Export desktop server utilities from `apps/host-daemon/src/local-control/index.ts`.
- Add `apps/host-daemon/tests/local-control-desktop-server.test.ts`.
- Add `apps/mac-native/Package.swift`.
- Add Swift files under `apps/mac-native/Sources/AbitatMac`.
- Add Swift tests under `apps/mac-native/Tests/AbitatMacTests`.
- Update root `package.json` so `dev:mac`, `mac:build`, `mac:start`, and `mac:test` target SwiftUI.

## Testing

- New host-daemon tests verify the desktop helper API lists projects, creates a normal phone pairing payload, sends prompts through the same Codex bridge, and preserves mobile server startup.
- Swift tests verify helper ready-line parsing and API model decoding.
- Existing host-daemon local-control tests continue to protect phone compatibility.
- iOS typecheck and validation continue to run unchanged.

## Migration Completion Criteria

- `pnpm mac:start` launches the SwiftUI app, not Electron.
- The SwiftUI app renders real local Codex projects and threads.
- Pairing from SwiftUI still creates a payload the phone app can consume.
- Existing phone API tests pass.
- Electron is no longer on the normal Mac runtime path.

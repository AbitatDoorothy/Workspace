# iPhone Remote Codex Plan

> **For agentic workers:** This is a planning document only. Do not implement from this file until the user approves the direction. Preserve the current Mac-only workflow as the default path while adding iPhone support beside it.

**Goal:** Add a native iPhone app that pairs with a MacBook running Abitat Workspace, lets the user access existing Abitat projects, remotely chat with Codex, keeps chat history synced across phone and Mac, and optionally streams the Mac screen to the phone while the phone acts as a trackpad and keyboard.

**Architecture:** Keep Abitat's existing web app and host daemon as the control plane/runtime owner. Add the iPhone as a `client` machine, add mobile-safe API and sync endpoints, and add a separate remote-control channel for screen sharing and input injection. The current Mac web UI, local project creation, daemon job polling, and visible Terminal-based Codex flow remain unchanged unless a user explicitly starts a phone or remote-control session.

**Tech Stack:** Existing pnpm monorepo, Next.js 16, Prisma/PostgreSQL, TypeScript host daemon, Cloudflare Worker tunnel, WebSocket/SSE, React Native/Expo iOS app, WebRTC for screen/input transport, macOS ScreenCaptureKit/CoreGraphics helper for screen capture and input.

---

## 1. Current Project Understanding

Abitat Workspace is currently a web-controlled local coding-agent runtime.

- `apps/web` is the Next.js UI and API server. It owns login, projects, conversations, run events, change sets, reviews, host pairing, daemon jobs, and a terminal WebSocket relay.
- `apps/host-daemon` is a TypeScript daemon that pairs with the web app, scans local tools, sends heartbeats, polls daemon jobs, sets up local folders/worktrees, starts Codex/Claude/mock runtimes, uploads run events/change sets, and acknowledges job completion.
- `packages/shared` contains Zod schemas for host pairing, heartbeats, tool scans, conversation creation, run events, approvals, and daemon jobs.
- `apps/web/prisma/schema.prisma` stores users, workspaces, machines, projects, agents, conversations, run events, change sets, and daemon jobs.
- `workers/workspace-tunnel.mjs` plus `scripts/worker-tunnel-client.mjs` expose the local web app over `workspace.abitat.io` through an outbound WebSocket relay.
- The current UI assumes `workspace_demo`, `user_demo`, `machine_demo`, and a local Mac folder workflow.
- The current host pairing model uses a shared pairing code and a host token hash, scoped to the demo host.
- The current live terminal relay is conversation-scoped at `/api/conversations/:id/terminal`. It can relay browser input to a PTY runtime, but the default Mac path still opens a visible local Terminal/iTerm tab.

Current behavior to preserve:

- `pnpm dev`, `pnpm cloud`, `pnpm dev:web`, and `pnpm dev:daemon` continue to work.
- Creating projects from local Mac folders continues to work.
- Starting Codex from the Mac web UI continues to open the local Codex CLI in the current visible-terminal mode.
- Continuing a Mac-started conversation continues to resume the stored Codex session on the Mac.
- Existing conversation, summary, review, commit, and push flows continue to work.
- Existing tests should continue to pass before any mobile behavior is enabled.

## 2. Happy Reference Takeaways

The `https://github.com/slopus/happy` project is useful as a reference, but not as a drop-in architecture.

Useful ideas:

- Use a native Expo app for iOS rather than a mobile-only web view.
- Treat phone, desktop, and daemon as separate devices that sync through a backend.
- Store encrypted or scoped sync payloads server-side so devices can reconnect and catch up.
- Use a shared wire/schema package for protocol messages.
- Use WebSocket-style real-time updates for conversation and device state.
- Store local device secrets under a per-app home directory on desktop and secure storage/keychain on mobile.

Reasons not to copy it directly:

- Abitat already has a host-daemon/job model instead of a CLI wrapper that replaces `codex`.
- Abitat already owns projects, workspaces, run events, change sets, and review/approval state.
- Abitat needs Mac screen sharing and input control, which is broader than Happy's chat/control flow.
- Happy's newer session protocol file says it is under review and not production-active, so Abitat should define its own minimal protocol around its current data model.

## 3. Product Assumptions

- The iPhone app should be a real iOS app, not just a responsive web page.
- The Mac must be awake, online, and running the Abitat daemon or packaged host app for remote Codex and screen control to work.
- The iPhone and Mac can be on different networks; the phone connects through `workspace.abitat.io` or the future hosted Abitat API, not directly to a LAN IP.
- Remote screen control is opt-in, session-based, and visibly indicated on the Mac.
- The first version can support one active controlling iPhone per Mac. Multiple viewing phones can be added later.
- Chat sync and project access should work without screen sharing.
- Screen sharing requires macOS Screen Recording permission; keyboard/trackpad control requires macOS Accessibility permission.
- Security should be stronger than the current demo pairing code before App Store or external use.

## 4. Recommended Architecture

Use three additive channels:

1. Control/data API: REST endpoints for auth, pairing, projects, conversations, and chat history.
2. Realtime sync: SSE or WebSocket for conversation messages, run events, device presence, and remote-control session status.
3. Remote-control media: WebRTC for Mac screen video and low-latency iPhone input events, with TURN fallback for different networks.

High-level flow:

```text
iPhone app
  authenticates and stores client token
  pairs to workspace and Mac host
  lists Abitat projects/conversations
  sends chat prompts and receives synced messages/events
  starts remote-control session when user chooses screen mode

workspace.abitat.io / Abitat web app
  stores workspace/project/conversation state
  stores paired phone and host machine state
  authorizes phone actions
  queues daemon jobs for Codex work
  relays realtime chat updates
  relays WebRTC signaling between iPhone and Mac host

Mac host daemon
  remains the local runtime owner
  polls daemon jobs as it does today
  starts/resumes Codex locally
  streams events and messages to web
  starts remote-control helper only when requested

macOS remote helper
  captures screen through ScreenCaptureKit
  injects pointer/keyboard through CoreGraphics
  connects to host daemon over localhost or stdio
  uses WebRTC for video and data-channel input
```

## 5. Data Model Additions

Add these without removing current columns.

### Machine

Extend the existing `Machine` model:

- `ownerUserId String?`: user who owns this device.
- `platform String?`: `darwin`, `ios`, `win32`, `linux`.
- `deviceKind String?`: `host`, `phone`, `browser`, later `tablet`.
- `publicKey String?`: optional device public key for signed/encrypted pairing.
- `tokenHash String?`: replace or sit beside `pairingTokenHash` for scoped device tokens.
- `pairedHostMachineId String?`: for phones paired to a specific Mac host.
- `capabilitiesJson Json?`: e.g. `["codex", "screen_capture", "input_control"]`.

Keep `type` for compatibility. Use `type = "host"` for Mac daemons and `type = "client"` for iPhones.

### DevicePairing

Create a short-lived pairing table:

- `id`
- `workspaceId`
- `hostMachineId`
- `createdByUserId`
- `codeHash`
- `expiresAt`
- `consumedAt`
- `approvedAt`
- `createdAt`

This replaces relying on the global `ABITAT-123456` code for phones while leaving the demo host code available for local development.

### ConversationMessage

Create a chat-friendly layer beside `RunEvent`:

- `id`
- `conversationId`
- `sequence`
- `role`: `user`, `assistant`, `system`, `runtime`
- `sourceDeviceId`
- `content`
- `metadataJson`
- `createdAt`

Keep `RunEvent` as the runtime/audit stream. `ConversationMessage` is for phone/Mac chat UI sync.

Backfill strategy:

- User audit events become `role = "user"`.
- Summary events become `role = "assistant"`.
- Runtime status/stdout can remain in `RunEvent` unless the UI needs them in chat.

### RemoteControlSession

Create a session table:

- `id`
- `workspaceId`
- `hostMachineId`
- `clientMachineId`
- `createdByUserId`
- `status`: `requested`, `connecting`, `active`, `ended`, `failed`
- `screenEnabled Boolean`
- `inputEnabled Boolean`
- `startedAt`
- `endedAt`
- `errorMessage`
- `createdAt`
- `updatedAt`

Keep signaling payloads transient when possible. If persisted for reconnect, use short TTL rows.

## 6. Shared Protocol Additions

Add schemas in `packages/shared/src/index.ts` for:

- phone pairing request/response,
- device heartbeat,
- conversation message create/list/stream payloads,
- remote-control session create/end payloads,
- WebRTC signaling envelope,
- input events.

Input event shape:

```ts
type RemoteInputEvent =
  | { type: "pointer"; phase: "down" | "move" | "up" | "scroll"; x: number; y: number; buttons?: number; dx?: number; dy?: number }
  | { type: "text"; value: string }
  | { type: "key"; key: string; code?: string; modifiers?: Array<"cmd" | "ctrl" | "alt" | "shift"> };
```

Coordinates should be normalized from `0..1` relative to the streamed display, then converted on the Mac helper to physical display coordinates.

## 7. Pairing Flow

Implement phone pairing as a new flow, not by reusing the host daemon's global demo code.

1. User opens Abitat on Mac.
2. Dashboard shows "Pair iPhone".
3. Web app creates a `DevicePairing` row for the current workspace and host machine.
4. Web UI shows QR code and short manual code.
5. iPhone scans QR or enters code.
6. iPhone sends device name, platform, app version, and a generated public key.
7. Server creates a `Machine` row with `type = "client"`, `deviceKind = "phone"`, and `pairedHostMachineId`.
8. Server returns a scoped phone token and workspace/host identity.
9. iPhone stores token in Keychain/SecureStore.
10. Mac dashboard shows the paired phone and last-seen state.

Security rules:

- Pairing codes expire after 5 minutes.
- Pairing codes are single-use and stored hashed.
- Phone tokens can read workspace/project/conversation state for the paired workspace.
- Phone tokens can only start remote Codex jobs on the paired host machine.
- Remote screen/input requires a fresh user action from the phone and a visible Mac indicator.

## 8. Project Access On iPhone

Add mobile API endpoints that return the same project and conversation state the web UI already uses.

Recommended endpoints:

- `GET /api/mobile/bootstrap`
- `GET /api/mobile/projects`
- `GET /api/mobile/projects/:projectId`
- `GET /api/mobile/projects/:projectId/conversations`
- `POST /api/mobile/projects/:projectId/conversations`

The phone should see projects already created at Abitat Workspace. It should not need to choose local Mac folders. A project created on the Mac remains the source of truth, including `hostLocalPath`.

For v1, block creating local-folder projects from iPhone unless the project path already exists on the Mac and was selected by the Mac user. This avoids unsafe remote filesystem browsing.

## 9. Chat History Sync

Implement chat sync with `ConversationMessage` plus existing run events.

Flow:

1. Phone opens a conversation.
2. Phone fetches `ConversationMessage` history and the latest `RunEvent` cursor.
3. Phone subscribes to realtime updates.
4. Phone sends a prompt as a `ConversationMessage(role=user)` and requests continuation.
5. Web queues a daemon job assigned to the paired Mac host.
6. Host daemon resumes the Codex session and streams run events.
7. Web converts selected assistant/runtime outputs into `ConversationMessage(role=assistant/runtime)` records.
8. Mac web UI and phone both receive the same message stream.

Important compatibility choice:

- Keep the current Mac `continueConversation` flow unchanged.
- Add a new phone-specific continuation path with `presentation = "remote_chat"` or `presentation = "pty"`.
- Do not switch Mac-started conversations from visible Terminal to headless/PTY unless the user explicitly continues from phone.

Files likely touched:

- `apps/web/prisma/schema.prisma`
- new Prisma migration under `apps/web/prisma/migrations`
- `packages/shared/src/index.ts`
- `apps/web/server/conversations/conversation-queue-service.ts`
- `apps/web/server/run-events/run-event-service.ts`
- new `apps/web/server/conversation-messages/*`
- new `apps/web/app/api/mobile/*`
- `apps/host-daemon/src/runtime/index.ts`
- `apps/host-daemon/src/runtime/pty.ts`
- `apps/host-daemon/src/cli/index.ts`
- tests under `apps/web/tests`, `apps/host-daemon/tests`, and `packages/shared/tests`

## 10. Remote Screen And Input Control

Build screen control separately from chat sync. This is the riskiest feature and should not be mixed into the first chat implementation.

Recommended design:

- Add a small macOS helper app/binary, e.g. `apps/mac-remote-helper`.
- Host daemon starts the helper only for an approved `RemoteControlSession`.
- Helper uses ScreenCaptureKit for display capture.
- Helper uses CoreGraphics `CGEvent` APIs for pointer and keyboard injection.
- Helper reports permission state to the host daemon.
- Phone and helper connect through WebRTC.
- Web app only handles auth and signaling, not raw video frames.

Why WebRTC:

- Works across different networks with ICE/STUN/TURN.
- Lower latency than pushing screenshots over the existing HTTP tunnel.
- Supports video track plus reliable/unreliable data channels for input.
- Lets the web API remain a signaling broker instead of a media server.

TURN options:

- MVP: configure a managed TURN provider or small coturn deployment.
- Later: evaluate Cloudflare Calls or LiveKit if the project wants managed sessions/recording/rooms.
- Existing Cloudflare Worker tunnel remains useful for API/WebSocket signaling but should not carry high-rate screen frames.

Phone input modes:

- Trackpad mode: the streamed screen is a view; finger movement sends relative pointer deltas.
- Direct touch mode: taps map to normalized screen coordinates.
- Keyboard mode: iOS keyboard sends text and special-key commands.
- Modifier bar: Command, Control, Option, Shift, Escape, Tab, Return, arrows.

Mac permission states:

- `screenCapture: unknown | granted | denied`
- `accessibility: unknown | granted | denied`
- `inputMonitoring: unknown | granted | denied` if needed later.

The Mac UI should show clear status and instructions when permissions are missing.

Files likely added/touched:

- new `apps/mac-remote-helper`
- `apps/host-daemon/src/remote-control/*`
- `apps/host-daemon/src/cli/index.ts`
- `apps/web/server/remote-control/*`
- `apps/web/app/api/remote-control/*`
- `apps/web/server/terminal/terminal-relay.ts` or a new WebSocket relay module
- `packages/shared/src/index.ts`
- iPhone app screens and hooks under `apps/ios`

## 11. iPhone App Plan

Add a new app at `apps/ios`.

Recommended stack:

- Expo React Native with a custom dev client.
- `expo-router` or plain React Navigation.
- Secure token storage with `expo-secure-store`.
- QR scanning with Expo Camera.
- WebSocket/SSE client for realtime sync.
- `react-native-webrtc` or LiveKit client for remote screen sessions.
- Shared API schemas imported from `@abitat/shared`.

Core screens:

- Pairing: QR scan, manual code, connection test.
- Workspace: host status, paired Mac, online/offline state.
- Projects: existing Abitat projects.
- Project detail: conversations and "Start Codex".
- Conversation: synced chat, run status, continue prompt box.
- Remote control: screen stream, trackpad/direct-touch mode, keyboard toolbar.
- Settings: paired devices, sign out, revoke phone token.

Do not expose commit/push approval on the phone in the first version unless explicitly requested. Start with read/chat/control because approval has higher consequences.

## 12. Remote Network Plan

Use the existing remote shape first:

- Phone API base URL defaults to `https://workspace.abitat.io`.
- Mac still runs `pnpm cloud` or the packaged equivalent, which starts web, tunnel, and host daemon.
- HTTP/WebSocket API traffic goes through the existing Cloudflare Worker relay.

For remote-control media:

- Web app creates WebRTC signaling sessions.
- iPhone and Mac helper exchange offers/answers/ICE candidates through Abitat.
- Use STUN first; require TURN fallback for reliability.
- If TURN is unavailable, fail the screen session gracefully while leaving chat sync active.

Later hardening:

- Move the Next.js app and database to a real hosted control plane, leaving only host daemon and remote helper on the Mac.
- Keep the current Worker tunnel as a local-dev/self-host option.

## 13. Non-Regression Strategy

All phone work should be additive and feature-gated.

Rules:

- Do not change the default `Start codex` Mac behavior.
- Do not require phone pairing for Mac-only use.
- Do not require remote-control helper for chat or normal daemon polling.
- Do not remove demo seed data or demo pairing until a replacement local-dev flow exists.
- Do not change current route URLs used by the Mac UI.
- New mobile routes should live under `/api/mobile/*`.
- New remote-control routes should live under `/api/remote-control/*`.
- New daemon capabilities should be optional and advertised through `capabilitiesJson`.

Recommended feature flags:

- `ABITAT_ENABLE_MOBILE_CLIENTS=1`
- `ABITAT_ENABLE_REMOTE_CONTROL=1`
- `ABITAT_REMOTE_CONTROL_TURN_URL`
- `ABITAT_REMOTE_CONTROL_HELPER_PATH`

## 14. Implementation Phases

### Phase 1: Foundation And Pairing

Goal: Pair an iPhone as a client device and list existing workspace projects.

Tasks:

- Add shared schemas for device pairing and mobile auth.
- Add Prisma migration for phone/client machines and pairing codes.
- Add `mobile` API auth helper that accepts scoped phone bearer tokens.
- Add pair-iPhone endpoint and QR/manual code generation.
- Add dashboard section for paired phones and pairing code.
- Scaffold `apps/ios` with pairing, token storage, and project list.
- Tests: shared schemas, pairing code expiry/single-use, phone token auth, project list authorization.

Verification:

- Existing `pnpm test` passes.
- Mac can still pair host with the current daemon flow.
- Phone simulator can pair and list projects without changing Mac UI behavior.

### Phase 2: Conversation Chat Sync

Goal: Phone can open a project, see conversation history, start/continue Codex, and keep chat synced with the Mac.

Tasks:

- Add `ConversationMessage` model and repository/service.
- Backfill or map existing audit/summary events into message history.
- Add mobile conversation endpoints.
- Add realtime stream endpoint for messages and status.
- Add phone-specific continuation path that queues the paired Mac host.
- Add daemon support for a remote chat/PTY presentation without changing visible Terminal default.
- Add iPhone conversation UI with prompt box, status, reconnect handling, and offline states.
- Tests: message ordering, idempotent sync, phone start/continue authorization, daemon job assignment to paired host, Mac default behavior unchanged.

Verification:

- Start a Codex conversation from Mac: visible Terminal behavior remains.
- Start/continue from iPhone: phone receives synced messages/events.
- Refresh phone and Mac pages: chat history matches.

### Phase 3: Remote Screen Session Signaling

Goal: Phone can request a remote-control session and connect to the Mac helper through signaling.

Tasks:

- Add `RemoteControlSession` model.
- Add remote-control REST/WebSocket signaling endpoints.
- Add host daemon control loop for remote session requests.
- Add iPhone remote-control connection UI with states.
- Add TURN/STUN configuration plumbing.
- Tests: session lifecycle, authorization, single-controller lock, signaling message routing, expiration/cleanup.

Verification:

- Phone can request/end a remote session.
- Mac daemon receives the request.
- Signaling works in simulator/unit tests without real media.
- Chat remains available when remote-control setup fails.

### Phase 4: macOS Screen Capture And Input Helper

Goal: Mac screen streams to iPhone and phone sends trackpad/keyboard input.

Tasks:

- Create `apps/mac-remote-helper`.
- Implement ScreenCaptureKit capture.
- Implement WebRTC video track and data channel.
- Implement CoreGraphics pointer and keyboard injection.
- Add permission detection and user-facing status.
- Add host daemon process management for helper start/stop.
- Add iPhone video surface, trackpad mode, direct-touch mode, and keyboard toolbar.
- Tests: helper protocol unit tests, input coordinate normalization, daemon helper lifecycle.
- Manual QA: actual Mac/iPhone or Mac/iOS Simulator screen session.

Verification:

- Mac asks for Screen Recording/Accessibility only when remote control is enabled.
- iPhone sees live Mac screen.
- Trackpad movement, clicks, scrolling, and keyboard input work.
- Ending the session stops capture and input injection.

### Phase 5: Hardening And Release

Goal: Make the feature safe enough for daily remote use.

Tasks:

- Add token revocation and paired-device management.
- Add lock-screen/biometric gate in the iPhone app.
- Add push notifications for Codex completion/permission-needed states.
- Add connection quality indicators and TURN diagnostics.
- Add audit events for remote-control start/end.
- Add App Store/EAS configuration.
- Add runbooks for local dev, pairing, permissions, and troubleshooting.

Verification:

- Revoke phone token: phone loses access immediately.
- Mac sleep/offline states show clearly.
- Different-network test passes with TURN fallback.
- App Store/TestFlight build succeeds.

## 15. Test Matrix

Automated tests:

- `packages/shared/tests/schemas.test.ts`
- `apps/web/tests/host-service.test.ts`
- new mobile pairing/auth tests
- new conversation message tests
- new remote-control session service tests
- `apps/web/tests/conversation-service.test.ts`
- `apps/host-daemon/tests/pty-runtime.test.ts`
- new host remote-control helper lifecycle tests
- iPhone app component/model tests where practical

Manual tests:

- Mac-only local demo with no phone paired.
- Mac-only cloud workflow with no phone paired.
- Pair phone over same network.
- Pair phone over cellular/different network.
- Start Codex from Mac and verify current Terminal behavior.
- Start Codex from phone and verify synced chat.
- Resume an existing Codex session from phone.
- Disconnect/reconnect iPhone mid-run.
- Put Mac offline and verify phone shows unavailable state.
- Start remote screen session with permissions granted.
- Start remote screen session with permissions denied.
- Trackpad, click, scroll, text input, special keys.
- End/revoke remote-control session.

## 16. Open Decisions

Before implementation, decide:

- Whether `apps/ios` should use Expo React Native or native SwiftUI. Recommendation: Expo React Native with a custom dev client.
- Whether remote-control media should use raw WebRTC or LiveKit. Recommendation: raw WebRTC for MVP unless managed TURN/rooms are desired immediately.
- Whether chat messages should be end-to-end encrypted at rest. Recommendation: design token scoping now, add E2E encryption once the baseline phone flow is stable.
- Whether phone can approve commit/push. Recommendation: defer.
- Whether phone can create new local-folder projects. Recommendation: defer; phone can only use projects already created from Mac.
- Whether remote-control requires a Mac-side approval click every time. Recommendation: require explicit session start from authenticated phone plus visible Mac indicator for MVP; add Mac approval prompt if multiple users/devices become common.

## 17. Success Criteria

This work is complete when:

- A Mac user can keep using Abitat exactly as they do now without pairing a phone.
- An iPhone can pair to the user's workspace/Mac and list projects already created in Abitat Workspace.
- Chat history for a conversation is consistent between iPhone and Mac after refresh/reconnect.
- Starting or continuing Codex from iPhone runs on the paired Mac and syncs output back to the phone.
- The phone and Mac can be on different networks.
- A remote-control session can stream the Mac screen to iPhone and accept phone trackpad/keyboard input.
- Remote-control permissions, offline states, and session endings are explicit and safe.
- Existing test suites pass, and new mobile/remote-control tests cover the new behavior.

# No-Domain, No-Database Mobile Control

## Purpose

This document defines the target Abitat mobile-control architecture that requires neither an Abitat-owned domain nor a shared hosted database.

This is the single method the project should move toward. The previous hosted Postgres and `workspace.abitat.io` control-plane approach is not retained as a parallel product path in this design.

## Core Idea

Each user's Mac becomes its own control plane.

The iPhone does not discover or connect to a shared Abitat server. Instead, the Mac starts a local Abitat/Codex bridge and exposes it through a per-user tunnel or private overlay network. The iPhone pairs directly to that Mac by scanning or entering a pairing payload generated locally on the Mac.

The phone and Mac can be on different networks because the tunnel or overlay provider supplies the rendezvous path between them. Abitat does not need to operate a public domain, central API, or shared database.

## Non-Negotiable Network Fact

Off-network control still requires a reachable path between the iPhone and Mac.

Removing Abitat's domain and database does not remove the need for networking infrastructure entirely. It moves that responsibility to one of these per-user mechanisms:

- A temporary reverse tunnel, such as Cloudflare Quick Tunnel, ngrok, or a similar provider.
- A private overlay network, such as Tailscale, where both devices can address each other privately.
- A user-managed public endpoint, such as a static public IP, port forwarding, or a personal VPS relay.

Without one of those paths, an iPhone on cellular cannot reliably reach a Mac behind a home, office, hotel, or carrier NAT.

## Target User Flow

1. User installs Abitat on the Mac.
2. User runs a local command, for example `abitat iphone`.
3. The Mac starts the local Codex app server if needed.
4. The Mac starts the local Abitat control server.
5. The Mac starts or validates a tunnel or overlay endpoint.
6. The Mac generates a short-lived pairing payload containing:
   - the reachable tunnel or overlay URL,
   - the Mac identity,
   - a one-time pairing secret,
   - expiration time,
   - optional local capability flags.
7. The user scans the QR code or enters the code in the iPhone app.
8. The iPhone exchanges the one-time pairing secret for a persistent device token issued by the Mac.
9. The iPhone stores the Mac endpoint and device token locally.
10. The iPhone controls Codex by talking to the paired Mac endpoint through the tunnel or overlay.

## Architecture

```text
iPhone app
  stores paired Mac endpoint and device token
  lists local Codex projects exposed by the Mac
  sends chat, input, and remote-control requests to the Mac

Tunnel or overlay provider
  provides reachability between phone and Mac
  stores no Abitat product state
  may relay encrypted transport packets depending on provider

Mac Abitat control server
  owns pairing, auth, local state, and API responses
  talks to Codex app-server or Codex CLI locally
  exposes projects, conversations, messages, status, and remote-control sessions

Codex app / Codex CLI on Mac
  remains the execution owner
  stores its own thread/session state locally
  performs all filesystem and coding-agent work on the Mac
```

## State Model

All durable Abitat state is local to the user's devices.

On the Mac:

- paired phone records,
- issued device-token hashes,
- local endpoint/tunnel configuration,
- Codex bridge configuration,
- remote-control session metadata,
- optional cached project and thread summaries.

On the iPhone:

- paired Mac endpoint,
- device token,
- display name for the Mac,
- last-seen workspace/project cache for faster startup,
- app preferences.

No shared server stores accounts, projects, conversations, messages, pairing records, remote-control sessions, uploads, or push subscriptions.

If a local store is needed on the Mac, use a simple local file or SQLite database under the user's application-support directory. This is a local implementation detail, not a shared hosted database.

## Pairing

Pairing is initiated on the Mac and completed on the iPhone.

The pairing payload should be short-lived and single-use. It should include enough information for the phone to reach the Mac and prove possession of the one-time secret.

Suggested payload shape:

```json
{
  "version": 1,
  "endpoint": "https://temporary-or-private-endpoint.example",
  "macId": "mac_...",
  "pairingCode": "ABITAT-123456",
  "expiresAt": "2026-05-09T12:00:00.000Z",
  "capabilities": ["codex_chat", "screen_control", "file_attachments"]
}
```

The iPhone sends the pairing code to the Mac endpoint. The Mac validates that the code is active, marks it consumed, creates or updates the phone record, and returns a device token.

After pairing, the iPhone authenticates every request with that device token.

## Authentication And Security

The Mac is the trust authority.

Minimum rules:

- Pairing codes expire quickly.
- Pairing codes are single-use.
- Device tokens are random, high entropy, and stored hashed on the Mac.
- The iPhone stores its token in secure storage.
- The Mac shows visible status while remote control is active.
- Remote screen/input control requires explicit user action from the phone.
- The Mac can revoke paired phones locally.
- The local control server should bind to localhost unless a tunnel or overlay explicitly exposes it.

Recommended hardening:

- Use HTTPS tunnels or overlay encryption.
- Pin the first paired Mac identity in the iPhone app.
- Rotate tunnel URLs without rotating the device token.
- Rate-limit pairing and token-authenticated requests.
- Require a fresh confirmation for screen/input control after long idle periods.

## Tunnels And Overlays

Abitat should treat connectivity as a pluggable local transport layer.

Recommended transport priority:

1. Tailscale or another private overlay for users who want durable private device-to-device access.
2. Temporary reverse tunnel for users who want simple setup without an account-level network.
3. User-provided endpoint for advanced users.

The app should not require an Abitat-owned hostname. If a tunnel provider returns a random URL, that URL is embedded in the pairing payload and stored by the phone.

If the tunnel URL changes, the user can re-pair or the Mac can refresh the endpoint through a local discovery handoff while both devices still have a valid path.

## Chat And Codex Control

The iPhone sends prompts directly to the Mac's local Abitat control server.

The Mac then chooses the local execution path:

- Codex app-server for native Codex desktop control.
- Codex CLI or PTY runtime for terminal-backed execution.
- Local snapshot APIs for listing projects, conversations, and messages.

Conversation history should be read from local Codex state where possible. Abitat should avoid duplicating full Codex history unless it needs a local cache for mobile performance.

## Remote Screen And Input

Remote screen/input should remain local-to-Mac state plus tunnel transport.

Preferred long-term transport:

- WebRTC for screen media and low-latency input.
- Tunnel or overlay used only for signaling when needed.

Acceptable early implementation:

- Polling or WebSocket signaling for low-rate control messages.
- Screenshot/frame relay only as a development bridge, not the final media path.

The Mac helper remains responsible for:

- Screen Recording permission.
- Accessibility permission.
- Capturing screen frames.
- Injecting pointer and keyboard events.
- Reporting permission errors to the iPhone.

## Push And Notifications

Without a hosted Abitat server, server-originated push notifications are not available in the same way.

Options:

- Rely on in-app polling while the iPhone app is open.
- Use local notifications scheduled by the iPhone while actively watching a task.
- Add optional direct push later through a provider-specific integration, but do not make it required for the core no-domain/no-database method.

The core product should work without push notifications.

## Attachments

Attachments should upload directly from the iPhone to the Mac endpoint.

The Mac stores them in a local temporary directory and passes local file paths into Codex where supported. The Mac should clean up expired uploads automatically.

Do not store attachments in a hosted database, hosted filesystem, or build output.

## Multi-User Meaning

Multiple users can independently use Abitat because each user's installation is isolated:

- Reece's iPhone pairs to Reece's Mac endpoint.
- Another user's iPhone pairs to that user's Mac endpoint.
- There is no global account registry.
- There is no shared workspace database.
- There is no Abitat server deciding who owns which Mac.

This design does not provide shared team workspaces. Team collaboration would require a separate local sharing model or a deliberately reintroduced shared service.

## Operational Implications

This method simplifies Abitat's hosted responsibilities but shifts setup and reliability concerns to the user's local environment.

Benefits:

- No Abitat-owned domain required.
- No hosted database required.
- No hosted account system required.
- Strong local ownership of Codex sessions and files.
- Low central infrastructure burden.

Tradeoffs:

- Tunnel or overlay setup becomes part of the product.
- Remote reachability depends on the chosen transport provider.
- No cross-device state exists unless the Mac is reachable.
- Push notifications are limited without a server.
- Lost Mac local state means lost Abitat pairing/control state.
- Team/workspace sharing is out of scope unless intentionally redesigned.

## Migration Direction

The codebase should converge on this local-first model:

- Remove hosted account requirements from the user flow.
- Remove dependency on hosted Postgres for pairing, projects, conversations, and remote-control sessions.
- Replace hosted API routes with Mac-local equivalents.
- Make the iPhone store a paired Mac endpoint instead of a shared API base URL.
- Keep Codex execution and state on the Mac.
- Treat tunnels and overlays as replaceable connectivity adapters.

The previous hosted Postgres and domain-based architecture should be considered superseded by this document.

## Success Criteria

This method is successful when:

- A fresh user can install Abitat on a Mac.
- The user can run one local command to start Codex control and create a pairing QR code.
- The iPhone can pair from cellular or another network.
- The iPhone can list Mac Codex projects and conversations.
- The iPhone can start and continue Codex work on the Mac.
- The Mac remains the only durable owner of Abitat and Codex state.
- No Abitat-owned domain or hosted database is required.

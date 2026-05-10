# Local-First No-Domain Remote Codex Control Plan

## Decision

Abitat should support a local-first remote-control mode where every user's Mac acts as the control plane for that user's phone.

This plan does not require an Abitat-hosted database or shared hosted workspace state. It uses `workspace.abitat.io` as a packet relay by default, while keeping the Mac as the authority for pairing, phone tokens, Codex state, and every control decision.

The product default is a Mac outbound WebSocket relay through `workspace.abitat.io`. This gives off-network reachability without asking the iPhone user to install a second networking app and without requiring `cloudflared`. Tailscale remains the durable private-network option for users who already have it on both devices.

## Goals

- Let anyone install Abitat on their Mac and pair their own iPhone.
- Keep Codex execution, filesystem access, project discovery, and thread state owned by the Mac.
- Let the iPhone control Codex on the Mac while on cellular or another network.
- Avoid hosted databases, shared workspace state, and central pairing records.
- Prevent one user's phone from ever controlling another user's Mac unless that Mac explicitly pairs it.
- Keep the user flow close to the current experience: install, run one Mac command, scan a pairing code, start controlling Codex.

## Non-Goals

- Shared team workspaces.
- A central account system.
- Server-originated push notifications from Abitat infrastructure.
- A browser-hosted authority that can grant control of a user's Mac.
- Cross-user project or conversation sync.
- A guaranteed off-network connection without any overlay or tunnel provider.

## Core Architecture

```text
iPhone app
  stores paired Mac endpoint and device token
  calls the Mac-local Abitat API through the selected transport

Per-user transport
  Abitat relay, Tailscale private network, Mac-side temporary tunnel, or user-managed endpoint
  provides reachability between iPhone and Mac
  stores no Abitat product state

Mac Abitat control server
  owns pairing, auth, local state, project APIs, and Codex bridge APIs
  binds to localhost or a private transport interface
  talks to Codex app-server or Codex CLI locally

Codex app on Mac
  remains the execution owner
  stores Codex threads and runtime state locally
```

The important shift is that the iPhone no longer talks to an Abitat cloud API as the control authority. In relay mode it sends encrypted envelopes through `workspace.abitat.io`; the paired Mac decrypts them, validates the phone token locally, and executes Codex locally.

## Transport Strategy

### 1. Default: Abitat Relay

User setup:

1. Install only the Abitat app on the iPhone.
2. Run `abitat iphone` on the Mac.
3. Scan the QR code in the iPhone app.

Mac behavior:

- Start the local Abitat control server on `127.0.0.1`.
- Open an outbound WebSocket to `workspace.abitat.io`.
- Create a unique relay id for this Mac pairing session.
- Embed the relay endpoint and relay id in the pairing payload.
- Decrypt relay envelopes locally and forward them to the Mac-local API.

Why this is the default:

- Works when the phone and Mac are not on the same Wi-Fi.
- Does not require an Abitat-hosted database.
- Does not require the user to install Tailscale or another app on the iPhone.
- Does not require `cloudflared`, which can be unreliable on Macs using fake-IP DNS or packet-tunnel proxies.
- Prevents the website from controlling Macs because only the Mac can consume pairings and mint/validate phone tokens.

Tradeoffs:

- Abitat must operate the `workspace.abitat.io` relay Worker.
- The relay must be treated as a router, not as a trusted authorization boundary.
- Public relay reachability requires strong envelope encryption and Mac-side request authentication.

### 2. Optional Temporary Tunnel

User setup:

1. Run `abitat iphone --transport temporary-tunnel`.

Mac behavior:

- Start a temporary HTTPS tunnel over the Mac's built-in SSH client.
- Prefer `localhost.run`, then fall back to Pinggy if needed.
- Parse the generated public tunnel URL.
- Embed that URL in the pairing payload.

Tradeoffs:

- Tunnel URLs are temporary and can change when the Mac command restarts.
- Provider availability is outside Abitat's control.

### 3. Optional Cloudflare Quick Tunnel

User setup:

1. Install `cloudflared` on the Mac.
2. Run `abitat iphone --transport quick-tunnel`.

Mac behavior:

- Start `cloudflared tunnel --url <local-control-url>`.
- Parse the generated `https://*.trycloudflare.com` URL.
- Fall back to the default temporary SSH tunnel if Cloudflare is unavailable.

Tradeoffs:

- The Mac needs `cloudflared`.
- Some network stacks resolve Cloudflare tunnel edges to fake `198.18.x.x` addresses and prevent `cloudflared` from connecting.
- Tunnel URLs are temporary and can change when the Mac command restarts.

### 4. Optional Durable Private Overlay: Tailscale

User setup:

1. Install Tailscale on the Mac.
2. Install Tailscale on the iPhone.
3. Sign both devices into the same tailnet.
4. Run `abitat iphone` on the Mac.
5. Scan the QR code in the iPhone app.

Mac behavior:

- Start the local Abitat control server on `127.0.0.1`.
- Detect Tailscale availability with `tailscale status --json`.
- Prefer a private Tailscale endpoint for pairing.
- Optionally use `tailscale serve` to expose the local control server over HTTPS inside the user's tailnet.
- Fall back to the Mac's Tailscale `100.x.y.z` address only when the iPhone app can safely call that endpoint.

Why this remains useful:

- Works when the phone and Mac are not on the same Wi-Fi.
- Does not require Abitat to own a domain.
- Does not require Abitat to run a database.
- Keeps the Mac reachable only to devices in the user's private network.
- Scales naturally because every user owns their own tailnet and Mac server.

Tradeoffs:

- The user needs Tailscale installed on both devices.
- The user needs a Tailscale account or organization.
- If Tailscale is disconnected, the phone cannot reach the Mac off-network.
- Public tunnel URLs need stronger request authentication and rate limiting.
- Users who need stable private reachability can opt into Tailscale or a manual endpoint.

### 4. Advanced: User-Managed Endpoint

Advanced users can provide their own endpoint:

- static public IP plus HTTPS reverse proxy,
- personal VPS relay,
- port-forwarded home router,
- self-managed tunnel.

Abitat should accept this as a manual endpoint in the pairing payload, but the normal onboarding should not depend on it.

## Pairing Flow

Pairing starts on the Mac and ends on the phone.

1. User runs `abitat iphone`.
2. The Mac starts or verifies the Codex app-server.
3. The Mac starts the local Abitat control server.
4. The Mac resolves the active transport endpoint.
5. The Mac creates a short-lived, single-use pairing secret.
6. The Mac displays a QR code and short manual code.
7. The iPhone scans the QR code.
8. The iPhone calls `POST /pairing/consume` on the Mac endpoint.
9. The Mac validates the pairing secret.
10. The Mac stores a hash of the issued phone token.
11. The iPhone stores the Mac endpoint, Mac identity, and token in secure storage.

Suggested QR payload:

```json
{
  "version": 1,
  "product": "abitat",
  "endpoint": "https://macbook.tailnet-name.ts.net",
  "macId": "mac_7fb0...",
  "pairingSecret": "one_time_secret",
  "expiresAt": "2026-05-09T12:00:00.000Z",
  "transport": "tailscale",
  "capabilities": ["codex_chat", "codex_projects", "attachments", "screen_control"]
}
```

The endpoint can also be an ephemeral tunnel URL or a user-managed URL. The phone should treat the QR payload as the source of truth for the first connection.

## Authentication And Authorization

The Mac is the trust authority.

Minimum rules:

- Pairing secrets expire quickly.
- Pairing secrets are single-use.
- Device tokens are random and high entropy.
- Device tokens are stored hashed on the Mac.
- Device tokens are stored in iOS secure storage on the phone.
- Every API request from the phone includes the device token.
- The Mac can revoke paired phones locally.
- The Mac exposes a visible status when remote control is active.
- Screen/input control requires an explicit action from the phone and must be revocable from the Mac.

For public or ephemeral tunnels:

- Require HTTPS.
- Rate-limit pairing attempts.
- Rate-limit token-authenticated requests.
- Reject requests without a valid token before touching Codex or filesystem state.
- Keep pairing endpoints active only while the Mac command is showing the pairing screen.

For Tailscale:

- Still require Abitat device-token auth.
- Do not rely only on the private network for authorization.
- If using Tailscale Serve identity headers later, treat them as an extra signal, not the only auth layer.

## Local State

All durable Abitat state lives on the user's devices.

Mac state:

- Mac identity.
- Paired phone records.
- Hashed phone tokens.
- Active pairing secrets.
- Transport configuration.
- Optional project/thread cache.
- Attachment staging records.
- Remote-control session metadata.

Suggested local storage:

```text
~/Library/Application Support/Abitat/
  config.json
  state.sqlite
  attachments/
  logs/
```

iPhone state:

- Paired Mac display name.
- Endpoint.
- Mac identity.
- Device token.
- Last seen project cache.
- Last selected model and effort.
- UI preferences.

No Abitat-hosted database stores users, workspaces, projects, conversations, pairings, or device tokens.

## API Surface On The Mac

The Mac-local Abitat server should expose the mobile API that the phone needs:

- `GET /health`
- `POST /pairing/consume`
- `GET /me`
- `GET /projects`
- `GET /projects/:projectId/conversations`
- `GET /conversations/:conversationId`
- `POST /conversations`
- `POST /conversations/:conversationId/messages`
- `GET /conversations/:conversationId/events`
- `POST /attachments`
- `GET /remote-control/status`
- `POST /remote-control/start`
- `POST /remote-control/input`
- `POST /remote-control/stop`

The phone should not need to know whether the Mac talks to Codex app-server, Codex CLI, or a local snapshot reader. That remains a Mac implementation detail.

## Codex Message And Thread Sync

The source of truth for Codex state remains the Mac.

Recommended behavior:

- The Mac reads project and thread state from Codex local state or Codex app-server.
- The Mac exposes normalized project, conversation, and message responses to the phone.
- The phone keeps a lightweight cache for fast startup.
- The phone refreshes from the Mac whenever a conversation opens or a polling tick fires.
- The phone never writes directly to Codex local files.
- New phone messages go through the Mac control server, which decides whether the current Codex runtime can accept them immediately or must queue them.

This preserves desktop-to-mobile sync because the phone reads the Mac's current local state.

## Remote Screen And Input

Remote screen/input should be local-to-Mac and transport-agnostic.

Initial implementation:

- The Mac helper captures screenshots after macOS Screen Recording permission is granted.
- The phone requests frames over WebSocket or polling.
- The phone sends pointer and keyboard events to the Mac.
- The Mac injects input after macOS Accessibility permission is granted.

Long-term implementation:

- Use WebRTC for screen frames and low-latency input.
- Use the selected transport only for signaling.
- Keep all media and input authorization local to the Mac.

Permissions:

- The Mac app or helper must surface missing Screen Recording permission.
- The Mac app or helper must surface missing Accessibility permission.
- Remote control must show a clear active indicator and a local stop control.

## Notifications

Completion push is Mac-owned in the local-first design. After pairing, the iPhone registers its Expo
push token with the paired Mac. The Mac stores that subscription locally and sends Codex completion
pushes directly through Expo/APNs when a new turn finishes.

Supported core behavior:

- In-app status polling while the iPhone app is open.
- Remote Expo/APNs completion notifications while the iPhone app is backgrounded or closed.
- Foreground notification mirroring so completion alerts still play a bundled sound while Abitat is open.

Optional future behavior:

- Additional provider-specific push transports.
- Tailscale-aware background refresh where iOS allows it.
- Hosted notification fanout only if we intentionally add account-level cloud state later.

## Attachments

Attachments go directly from the iPhone to the Mac endpoint.

Flow:

1. Phone uploads attachment to `POST /attachments`.
2. Mac stores the file under local temporary Abitat storage.
3. Mac passes the local file path into Codex where supported.
4. Mac deletes expired attachment files.

No hosted object storage is required.

## Public User Onboarding

Recommended user-facing flow:

1. Install Abitat CLI on Mac:

   ```bash
   brew install abitatdoorothy/abitat/abitat
   ```

2. Install the Abitat iPhone app.
3. Run:

   ```bash
   abitat iphone
   ```

5. Abitat starts the Codex bridge and shows a QR code.
6. Open the iPhone app and scan the QR code.
7. The phone lists the Mac's local Codex projects.
8. The user starts or continues Codex conversations from the phone.

If the user prefers Tailscale:

```bash
abitat iphone --transport tailscale
```

The CLI should clearly label tunnel URLs as temporary.

## Scaling Model

This supports many users by avoiding shared infrastructure.

Each user has:

- their own Mac,
- their own local Abitat control server,
- their own phone token,
- their own transport path,
- their own Codex local state.

Abitat does not need to scale a central database or global API to support these users. The main scaling work is product packaging, transport setup clarity, and robust local diagnostics.

This does not create a shared multi-user workspace product. If team collaboration is needed later, it should be designed separately.

## Failure Modes

### Temporary Tunnel Unavailable

`abitat iphone` should explain that off-network use needs a reachable Mac-side transport, then offer:

- relay mode,
- rerunning temporary tunnel fallback,
- same-network local pairing,
- Tailscale mode.

### Tailscale Installed But Disconnected

The CLI should show:

- Tailscale status,
- current Mac tailnet identity if available,
- next action to reconnect.

### Tunnel URL Changed

The phone should show the Mac as unreachable and ask the user to re-pair or refresh the endpoint from the Mac.

### Mac Sleeping Or Offline

The phone should show the Mac as offline. It cannot control Codex until the Mac is awake and the transport is connected.

### Codex App-Server Not Running

The Mac CLI should start it if possible. If it cannot, the phone should receive a clear "Codex unavailable" status.

### Permissions Missing

Chat can still work without Screen Recording or Accessibility permissions. Remote screen/input should show specific permission errors.

## Implementation Milestones

### Milestone 1: Local Mac Control Server

- Add a Mac-local HTTP/WebSocket API that mirrors the current mobile API shape.
- Store paired devices locally.
- Keep the server bound to localhost by default.
- Verify project listing and basic chat over localhost.

### Milestone 2: Pairing Without Hosted API

- Generate QR payloads locally.
- Add short-lived, single-use pairing secrets.
- Add token issuance and token hashing on the Mac.
- Make the iPhone store endpoint and token locally.

### Milestone 3: Tailscale Transport

- Detect Tailscale.
- Resolve a reachable private endpoint.
- Optionally configure or validate `tailscale serve`.
- Show actionable diagnostics when Tailscale is missing or disconnected.

### Milestone 4: iPhone Endpoint Mode

- Replace hardcoded hosted API assumptions with paired-Mac endpoint selection.
- Route projects, conversations, messages, attachments, and status calls to the paired Mac.
- Preserve local phone cache for startup speed.

### Milestone 5: Remote Codex Control

- Send phone prompts through the Mac control server.
- Read Codex project and thread state from the Mac.
- Keep desktop-to-mobile visibility by polling or streaming Mac state.
- Keep message queuing rules local to the Mac.

### Milestone 6: Remote Screen And Input

- Add Mac permission checks.
- Add screenshot/frame transport.
- Add pointer and keyboard input transport.
- Add visible local stop control on the Mac.

### Milestone 7: Packaging And Onboarding

- Make `brew install` install the CLI and Mac helper.
- Make `abitat iphone` produce a complete setup status page in the terminal.
- Publish iPhone onboarding that assumes no Abitat account and no Abitat domain.

## Acceptance Criteria

The design is successful when:

- A fresh user can install Abitat on their Mac.
- The user can install the iPhone app.
- The user can run one local command on the Mac.
- The command shows a QR code.
- The iPhone can pair by scanning the QR code.
- The iPhone can list Codex projects from that Mac.
- The iPhone can start or continue a Codex conversation on that Mac.
- The iPhone can do this from cellular while the Mac is on home Wi-Fi, as long as the selected transport is connected.
- No Abitat-hosted database is required.
- No Abitat-owned domain is required.
- Another user's phone cannot see or control this Mac unless this Mac explicitly pairs it.

## Feasibility Conclusion

This method is feasible for Abitat as a local-first, per-user remote Codex control tool.

It is not feasible if the requirement is interpreted as "remote control across networks with no Abitat server, no database, no domain, and no third-party or user-provided networking layer." Off-network control always requires some reachable path. The practical version is:

- no Abitat-owned domain,
- no Abitat-hosted database,
- Mac-owned local state,
- phone-to-Mac pairing,
- Tailscale or tunnel transport for off-network reachability.

That version can support many independent users and prevents the cross-user contamination issues that appeared with the hosted shared-control-plane approach.

## References

- Existing project architecture note: `docs/architecture/no-domain-no-database-mobile-control.md`
- Tailscale Serve documentation: https://tailscale.com/docs/features/tailscale-serve
- Tailscale Serve command documentation: https://tailscale.com/kb/1242/tailscale-serve
- Cloudflare Tunnel documentation: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- Cloudflare alternative tunnel workflows: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/

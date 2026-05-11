# Abitat User Onboarding

Share this guide with a new Mac and iPhone user.

## What Abitat Does

Abitat lets an iPhone control Codex running on a paired Mac. The Mac is the control plane: it owns Codex execution, local project discovery, pairing, and device-token auth. The iPhone reaches that Mac through the Abitat relay, Tailscale, a temporary tunnel, or another user-managed endpoint.

## Requirements

- A Mac with Homebrew installed.
- Codex installed and signed in on the Mac.
- The Abitat iPhone app installed.

## Install On Mac

```sh
brew tap AbitatDoorothy/abitat
brew install abitat
```

If the formula has been accepted into Homebrew core, use:

```sh
brew install abitat
```

## Start The Mac Host

```sh
abitat iphone
```

This starts the Mac-local Abitat control server, starts or connects to the local Codex app-server, connects the Mac outbound to the Abitat relay at `workspace.abitat.io`, and prints a QR code plus a manual JSON payload. The pairing payload expires quickly and can be used only once. The iPhone still only needs the Abitat app.

The relay routes encrypted envelopes. It cannot mint phone tokens, list projects, or control Codex by itself; the paired Mac validates every request locally.

The default is equivalent to:

```sh
abitat iphone --transport relay
```

For a same-machine/local test, use:

```sh
abitat iphone --transport local
```

For Tailscale instead of the relay, use:

```sh
abitat iphone --transport tailscale
```

Temporary tunnels remain available as fallback/demo modes:

```sh
abitat iphone --transport temporary-tunnel
brew install cloudflared
abitat iphone --transport quick-tunnel
```

## Pair The iPhone

1. Open the Abitat iPhone app.
2. Scan the QR code shown by `abitat iphone`, or paste the manual payload.
3. Confirm the phone shows the paired Mac and local workspace.
4. Open Projects to list Codex projects read from that Mac.

## Use It

1. On the iPhone, open Projects.
2. Choose a project synced from the Mac.
3. Tap New Thread.
4. Send a message from the chat screen.
5. Keep `abitat iphone` running on the Mac while Codex works.

When the Abitat app asks for notification permission, allow it. The paired Mac stores that phone's
Expo push subscription locally and sends Codex completion alerts directly through Expo/APNs, so the
iPhone can receive sound/vibration notifications even if Abitat is in the background or closed.

After pairing, the iPhone reconnects with the stored Mac endpoint and device token. Another phone cannot control the Mac unless this Mac creates and consumes a new pairing payload for it.

## Troubleshooting

- Run `abitat doctor` to confirm the CLI is installed.
- If the phone cannot pair off-network, keep `abitat iphone` running and check that the relay endpoint is reachable.
- If the pairing payload expired, run `abitat iphone` again and scan the new code.
- If no projects appear, keep the Mac command running and refresh the iPhone Projects screen.
- If Codex does not start, open Codex on the Mac or set `CODEX_APP_SERVER_URL` to a reachable local Codex app-server.
- For iPhone control issues, watch the Abitat mobile-control diagnostics log on the Mac:

```sh
tail -f ~/Library/Logs/Abitat/mobile-control.log
```

This is Abitat's Mac-side mobile-control log, not the Codex desktop app log. It records redacted
JSON lines for pairing, relay, task submission, Codex thread/turn calls while work is active,
message counts while Codex is running, and completion notifications. Idle polling and routine list
refreshes are suppressed so the file does not grow continuously when no task is running. Review it
before sharing, then send it to support if needed.

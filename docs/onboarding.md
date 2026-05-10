# Abitat User Onboarding

Share this guide with a new Mac and iPhone user.

## What Abitat Does

Abitat lets an iPhone control Codex running on a paired Mac. The Mac is the control plane: it owns Codex execution, local project discovery, pairing, and device-token auth. The iPhone connects directly to that Mac through Tailscale, a temporary tunnel, or another user-managed endpoint.

## Requirements

- A Mac with Homebrew installed.
- Codex installed and signed in on the Mac.
- `cloudflared` installed on the Mac for off-network control without another iPhone app.
- The Abitat iPhone app installed.

## Install On Mac

```sh
brew tap AbitatDoorothy/abitat
brew install abitat
```

Install the Mac-side tunnel helper:

```sh
brew install cloudflared
```

If the formula has been accepted into Homebrew core, use:

```sh
brew install abitat
```

## Start The Mac Host

```sh
abitat iphone
```

This starts the Mac-local Abitat control server, starts or connects to the local Codex app-server, starts a Cloudflare Quick Tunnel from the Mac, and prints a QR code plus a manual JSON payload. The pairing payload expires quickly and can be used only once.

If Cloudflare Quick Tunnel cannot connect from the current network, Abitat falls back to a temporary `localhost.run` HTTPS tunnel over the Mac's built-in SSH client. The iPhone still only needs the Abitat app.

For a same-machine/local test, use:

```sh
abitat iphone --transport local
```

For Tailscale instead of a temporary tunnel, use:

```sh
abitat iphone --transport tailscale
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

After pairing, the iPhone reconnects with the stored Mac endpoint and device token. Another phone cannot control the Mac unless this Mac creates and consumes a new pairing payload for it.

## Troubleshooting

- Run `abitat doctor` to confirm the CLI is installed.
- If `cloudflared` is missing, install it with `brew install cloudflared` and run `abitat iphone` again.
- If the phone cannot pair off-network, rerun `abitat iphone`; Quick Tunnel URLs are temporary and change between runs.
- If the pairing payload expired, run `abitat iphone` again and scan the new code.
- If no projects appear, keep the Mac command running and refresh the iPhone Projects screen.
- If Codex does not start, open Codex on the Mac or set `CODEX_APP_SERVER_URL` to a reachable local Codex app-server.

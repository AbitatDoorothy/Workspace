# Public Install

Abitat’s public mobile-control flow is local-first. The Mac runs the control server, owns Codex state, issues pairing payloads, and accepts iPhone requests directly through the selected transport. No Abitat-hosted domain, hosted database, or hosted account is required for core iPhone control.

## Mac

Install the CLI with Homebrew:

```sh
brew tap Abitat/abitat
brew install abitat
```

After the formula is accepted into Homebrew core, users can skip the tap step:

```sh
brew install abitat
```

The npm package remains available as an alternate install path:

```sh
npm install -g @abitat_reece/cli
```

Install the Mac-side tunnel helper. The iPhone does not need Cloudflare, Tailscale, or any other networking app:

```sh
brew install cloudflared
```

Start the Mac host:

```sh
abitat iphone
```

This command:

1. Starts the packaged `@abitat_reece/host-daemon` local-control server.
2. Starts or connects to the local Codex app-server.
3. Starts `cloudflared tunnel --url <local-control-url>` on the Mac.
4. Creates a short-lived, single-use pairing secret on the Mac.
5. Prints a QR code and manual pairing payload containing the temporary `trycloudflare.com` URL.
6. Stores paired device records and token hashes under `~/Library/Application Support/Abitat/`.

## iPhone

Install the Abitat iPhone app, scan the QR code from the Mac command, or paste the manual pairing payload. The app stores the paired Mac endpoint and device token locally and uses those for reconnects.

## Network Model

Remote control works off-network through the Mac-side Quick Tunnel:

- `abitat iphone` defaults to `--transport quick-tunnel`.
- The tunnel URL is temporary and can change when the Mac command restarts.
- The iPhone only needs the Abitat app because the tunnel terminates on the Mac side.
- `abitat iphone --transport tailscale` remains available for users who already run Tailscale on both devices.
- `abitat iphone --transport manual --endpoint <url>` lets advanced users provide their own endpoint.

The Mac still requires Abitat device-token auth for every iPhone request. The tunnel only provides reachability; it is not the product authorization boundary.

Hosted `workspace.abitat.io` mobile-control APIs are no longer the public control path.

## Maintainer Release Check

Before publishing, run:

```sh
pnpm smoke:public-install
pnpm test:homebrew
```

This builds and packs `@abitat_reece/shared`, `@abitat_reece/host-daemon`, and `@abitat_reece/cli`, installs them into a clean temporary npm project, verifies `abitat doctor`, and verifies that the CLI can resolve the packaged host daemon entrypoint.

The Homebrew formula lives at `Formula/abitat.rb`. Release it by copying that file to the `Abitat/homebrew-abitat` tap repository, then update the formula URL and SHA when publishing a new `@abitat_reece/cli` version.

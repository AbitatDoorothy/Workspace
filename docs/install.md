# Public Install

Abitat’s public mobile-control flow is local-first. The Mac runs the control server, owns Codex state, issues pairing payloads, and accepts iPhone requests directly through the selected transport. No Abitat-hosted domain, hosted database, or hosted account is required for core iPhone control.

## Mac

Install the CLI with Homebrew:

```sh
brew tap AbitatDoorothy/abitat
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

Start the Mac host:

```sh
abitat iphone
```

This command:

1. Starts the packaged `@abitat_reece/host-daemon` local-control server.
2. Starts or connects to the local Codex app-server.
3. Connects the Mac outbound to the Abitat relay at `workspace.abitat.io`.
4. Creates a short-lived, single-use pairing secret on the Mac.
5. Prints a QR code and manual pairing payload containing the relay endpoint and relay id.
6. Stores paired device records and token hashes under `~/Library/Application Support/Abitat/`.

## iPhone

Install the Abitat iPhone app, scan the QR code from the Mac command, or paste the manual pairing payload. The app stores the paired Mac endpoint and device token locally and uses those for reconnects.

## Network Model

Remote control works off-network through the Abitat relay:

- `abitat iphone` defaults to `--transport relay`.
- The relay URL is stable, but the relay id and pairing secret are Mac-generated and short-lived.
- The iPhone only needs the Abitat app because the Mac keeps an outbound relay connection open.
- The relay forwards encrypted envelopes only. The Mac still creates pairing secrets, mints phone tokens, validates requests, and owns Codex execution.
- `abitat iphone --transport temporary-tunnel` remains available as a fallback/demo path using `localhost.run` and Pinggy.
- `abitat iphone --transport quick-tunnel` remains available for users who install `cloudflared` and are on a network where Cloudflare Quick Tunnel works.
- `abitat iphone --transport tailscale` remains available for users who already run Tailscale on both devices.
- `abitat iphone --transport manual --endpoint <url>` lets advanced users provide their own endpoint.

The Mac still requires Abitat device-token auth for every iPhone request. The tunnel only provides reachability; it is not the product authorization boundary.

Hosted `workspace.abitat.io` mobile-control APIs are not the authority for core control. It is a relay endpoint; the paired Mac remains the authorization boundary.

## Maintainer Release Check

Before publishing, run:

```sh
pnpm smoke:public-install
pnpm test:homebrew
```

This builds and packs `@abitat_reece/shared`, `@abitat_reece/host-daemon`, and `@abitat_reece/cli`, installs them into a clean temporary npm project, verifies `abitat doctor`, and verifies that the CLI can resolve the packaged host daemon entrypoint.

The Homebrew formula lives at `Formula/abitat.rb`. Release it by copying that file to the `AbitatDoorothy/homebrew-abitat` tap repository, then update the formula URL and SHA when publishing a new `@abitat_reece/cli` version.

# Public Install

Abitat’s public hosted flow uses `workspace.abitat.io` as the control plane. The Mac connects outbound to the hosted API, and the iPhone app also talks to the hosted API. The phone does not need to be on the same network as the Mac.

## Mac

Install the CLI after the public npm packages have been published:

```sh
npm install -g @abitat/cli
```

After the Homebrew tap is released, the equivalent install command can be:

```sh
brew install abitat
```

Start the Mac host:

```sh
abitat iphone
```

This command:

1. Opens `https://workspace.abitat.io` for registration or login.
2. Stores a CLI session in `~/Library/Application Support/Abitat/config.json`.
3. Registers the Mac host to the signed-in account.
4. Starts the local Codex app server.
5. Starts the packaged `@abitat/host-daemon` dependency with hosted API credentials.
6. Opens the hosted dashboard for iPhone pairing.

## iPhone

Install the Abitat iPhone app, keep the API URL set to `https://workspace.abitat.io`, then pair using the code shown in the Mac dashboard.

## Network Model

Remote control works off-network because both devices communicate through `workspace.abitat.io`:

- The Mac daemon polls and heartbeats to the hosted API using its host token.
- The iPhone sends project, conversation, and message requests to the hosted API using its pairing token.
- Hosted job routing assigns phone-started Codex work to the paired Mac host.
- Push notifications are delivered from the hosted API to the iPhone.

No inbound port forwarding, LAN discovery, or shared Wi-Fi is required.

## Maintainer Release Check

Before publishing, run:

```sh
pnpm smoke:public-install
```

This builds and packs `@abitat/shared`, `@abitat/host-daemon`, and `@abitat/cli`, installs them into a clean temporary npm project, verifies `abitat doctor`, and verifies that the CLI can resolve the packaged host daemon entrypoint.

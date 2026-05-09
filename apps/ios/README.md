# Abitat iPhone App

Native iPhone client for pairing with an Abitat Mac host, browsing existing workspace projects,
continuing Codex remotely, syncing chat history, and starting remote-control sessions.

## Local Development

```bash
pnpm --filter abitat-ios install
pnpm --filter abitat-ios start
```

The app pairs from a Mac-generated QR/manual payload. The payload provides the Mac endpoint,
Mac identity, and one-time pairing secret; after pairing, the app stores the endpoint and device
token locally for reconnects. The default development endpoint is `http://127.0.0.1:3901`, but real
devices should pair from the QR payload printed by `abitat iphone`. Off-network pairing uses a
Mac-side Quick Tunnel, so the iPhone only needs the Abitat app.

## Notification Sounds

Codex completion sounds use the bundled `codex-done-*.wav` files declared in `app.json` through the
`expo-notifications` config plugin. Expo copies these files into the native iOS app at build time.
Without a hosted Abitat push service, core status updates come from foreground polling or an active
connection to the paired Mac.

Changing, adding, or removing these sounds requires rebuilding and reinstalling the iPhone app.
JavaScript-only reloads cannot add new native notification sound assets to an already installed iOS
binary.

## Screens

- Pairing: QR scanning plus manual payload paste from `abitat iphone`.
- Workspace: paired Mac status and connection summary.
- Projects: Codex projects read from the paired Mac.
- Project detail: existing conversations and remote Codex start flow.
- Conversation: synced chat history, reconnectable message stream, and continue prompt.
- Remote control: WebRTC session state, trackpad/direct-touch modes, and keyboard toolbar.
- Settings: API endpoint, paired device identity, and sign out.

Remote control uses the paired Mac's local signaling endpoints for status, input, and first-pass
screen frame relay. Native WebRTC media can be added later without changing the pairing or chat
flow.

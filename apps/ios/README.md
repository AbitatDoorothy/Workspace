# Abitat iPhone App

Native iPhone client for pairing with an Abitat Mac host, browsing existing workspace projects,
continuing Codex remotely, syncing chat history, and starting remote-control sessions.

## Local Development

```bash
pnpm --filter abitat-ios install
pnpm --filter abitat-ios start
```

Set `ABITAT_MOBILE_API_URL` in Expo config or the pairing screen when testing against a local
tunnel. The default API base is `https://workspace.abitat.io`.

## Notification Sounds

Codex completion pushes use the bundled `codex-done-*.wav` sounds declared in `app.json` through
the `expo-notifications` config plugin. Expo copies these files into the native iOS app at build
time, and the web API sends the selected filename in the Expo push payload.

Changing, adding, or removing these sounds requires rebuilding and reinstalling the iPhone app.
JavaScript-only reloads cannot add new native notification sound assets to an already installed iOS
binary.

## Screens

- Pairing: manual code entry with space for QR scanner integration.
- Workspace: paired Mac status and connection summary.
- Projects: existing Abitat Workspace projects created from the Mac.
- Project detail: existing conversations and remote Codex start flow.
- Conversation: synced chat history, reconnectable message stream, and continue prompt.
- Remote control: WebRTC session state, trackpad/direct-touch modes, and keyboard toolbar.
- Settings: API endpoint, paired device identity, and sign out.

Remote control uses the Abitat signaling endpoints for status, input, and first-pass screen frame
relay. Native WebRTC media can be added later without changing the pairing or chat flow.

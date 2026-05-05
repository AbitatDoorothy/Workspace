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

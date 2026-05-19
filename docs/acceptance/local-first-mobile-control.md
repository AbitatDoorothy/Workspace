# Local-First Mobile Control Acceptance

- [ ] Fresh Mac has no Abitat CLI or host daemon config.
- [ ] `brew tap AbitatDoorothy/abitat` succeeds.
- [ ] `brew install abitat` installs an `abitat` executable.
- [ ] `npm install -g @abitat_reece/cli` installs an `abitat` executable and the packaged host daemon dependency.
- [ ] `abitat doctor` reports that local iPhone control does not require an Abitat hosted login.
- [ ] `abitat iphone` starts the Mac-local control server.
- [ ] `abitat iphone` connects the Mac outbound to the Abitat relay when no transport is specified.
- [ ] `abitat iphone` prints a QR code and manual pairing payload with `transport: "relay"` and a relay id.
- [ ] The Abitat iPhone app pairs by scanning the QR code or pasting the manual payload.
- [ ] The paired iPhone lists Codex projects read from that Mac.
- [ ] The paired iPhone opens or starts a conversation and sends a message through that Mac.
- [ ] The phone can reconnect using the stored endpoint and device token.
- [ ] An unpaired phone, missing token, or invalid token is rejected.
- [ ] An expired or already-consumed pairing payload is rejected.
- [ ] Phone on cellular can control the Mac while the Mac remains online and `abitat iphone` is running.
- [ ] Core mobile control succeeds without a hosted account or hosted database; `workspace.abitat.io` is only an encrypted relay.

## Whole Mac Remote Control Acceptance

- [ ] Start the Mac host with `abitat iphone`.
- [ ] Pair the iPhone with the QR/manual payload from that Mac.
- [ ] Open the dashboard page that shows token usage, Request Log, and Disconnect.
- [ ] Tap START REMOTE CONTROL on that dashboard page.
- [ ] If macOS permission is missing, the iPhone shows Screen Recording or Accessibility as needed and existing project/thread functions still work.
- [ ] After granting permission, return to the dashboard and tap START REMOTE CONTROL again; the phone shows a whole-Mac frame.
- [ ] Tapping the frame sends a click to the Mac.
- [ ] Typing text and pressing Send Text enters that text on the Mac.
- [ ] Tap End Session.
- [ ] Return to Projects and confirm projects, expanded threads, archive, unread LEDs, chat, queue/steer, logs, token dashboard, generated files, and notifications still behave as before.

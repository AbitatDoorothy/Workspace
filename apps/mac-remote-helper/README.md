# Abitat Remote Helper

macOS helper process started by the host daemon when an iPhone requests a remote-control session.

The helper is intentionally separate from the normal host daemon. It only starts when
`ABITAT_ENABLE_REMOTE_CONTROL=1` and `ABITAT_REMOTE_CONTROL_HELPER_PATH` points to a built helper.

## Build

```bash
cd apps/mac-remote-helper
swift build -c release
```

Set:

```bash
export ABITAT_ENABLE_REMOTE_CONTROL=1
export ABITAT_REMOTE_CONTROL_HELPER_PATH="$PWD/.build/release/AbitatRemoteHelper"
```

The helper uses:

- CoreGraphics for pointer, scroll, keyboard, and text events.
- `CGDisplayCreateImage` for the first relay implementation.
- The Abitat remote-control signaling endpoints for status, frame, and input messages.

Screen Recording and Accessibility permissions are required by macOS before real control works.
The future WebRTC transport can replace `ScreenFrameRelay` while keeping the same signaling routes.

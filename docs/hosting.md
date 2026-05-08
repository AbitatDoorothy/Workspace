# Hosted Deployment

`workspace.abitat.io` must run the web app and API with persistent database storage. Public Mac and iPhone clients should use this hosted URL by default.

## Required Environment

```text
DATABASE_URL
ABITAT_SESSION_SECRET
ABITAT_PUBLIC_URL=https://workspace.abitat.io
EXPO_ACCESS_TOKEN or production push notification credentials
APPLE_TEAM_ID/APNs configuration for production iPhone builds
```

## Required Behaviors

- Account registration and login must be enabled.
- CLI device login routes must be publicly reachable.
- Host registration must require a valid CLI token.
- Pairing codes must be scoped to the signed-in account workspace.
- Mobile API requests must route phone-started Codex jobs to the paired Mac host.
- The host daemon must connect outbound to the hosted API; the hosted API must not require inbound access to the Mac.

## Release Checks

Before publishing a public CLI or iPhone build, run the full project verification suite and complete the manual acceptance checklist in `docs/acceptance/public-hosted-mobile-control.md`.

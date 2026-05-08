# Abitat User Onboarding

Share this guide with a new Mac and iPhone user.

## What Abitat Does

Abitat lets an iPhone control Codex running on a paired Mac. The Mac and iPhone do not need to be on the same network because both devices connect outbound to `https://workspace.abitat.io`.

## Requirements

- A Mac with Homebrew installed.
- Codex installed and signed in on the Mac.
- An Abitat account at `https://workspace.abitat.io`.
- The Abitat iPhone app installed.

## Install On Mac

```sh
brew tap Abitat/abitat
brew install abitat
```

If the formula has been accepted into Homebrew core, use:

```sh
brew install abitat
```

## Start The Mac Host

```sh
abitat iphone
```

This opens `workspace.abitat.io`, asks the user to register or log in if needed, registers the Mac to that account, starts the local Codex bridge, and opens the pairing dashboard.

## Pair The iPhone

1. Open the Abitat iPhone app.
2. Keep the API URL as `https://workspace.abitat.io`.
3. In the web dashboard on the Mac, open iPhone pairing.
4. Scan the QR code or enter the pairing code in the iPhone app.
5. Confirm the phone shows the paired workspace and projects.

## Use It

1. On the iPhone, open Projects.
2. Choose a project synced from the Mac.
3. Tap New Thread.
4. Send a message from the chat screen.
5. Keep `abitat iphone` running on the Mac while Codex works.

## Troubleshooting

- Run `abitat doctor` to confirm the CLI is installed and logged in.
- If the phone cannot pair, confirm both devices are using `https://workspace.abitat.io`.
- If no projects appear, keep the Mac command running and refresh the iPhone Projects screen.
- If Codex does not start, confirm the `codex` command works in the Mac terminal.

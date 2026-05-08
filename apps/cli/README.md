# Abitat CLI

`abitat` connects a Mac host to the hosted Abitat Workspace control plane so an iPhone can control Codex off-network. The CLI installs `@abitat/host-daemon` as a dependency and launches it directly.

## Install

```sh
npm install -g @abitat/cli
```

Homebrew packaging is planned for the public release:

```sh
brew install abitat
```

## Use

```sh
abitat iphone
```

The command opens `https://workspace.abitat.io` for login if needed, registers the Mac to the signed-in account, starts the Codex app server and packaged Abitat host daemon, then opens the dashboard for iPhone pairing.

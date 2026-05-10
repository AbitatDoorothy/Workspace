# Abitat CLI

`abitat` starts a Mac-local control server so a paired iPhone can control Codex through that Mac. The CLI installs `@abitat_reece/host-daemon` as a dependency and launches it directly; core iPhone control uses `workspace.abitat.io` only as an encrypted relay and does not require a hosted database.

## Install

```sh
brew tap AbitatDoorothy/abitat
brew install abitat
```

If the formula is accepted into Homebrew core, this becomes:

```sh
brew install abitat
```

The npm package is also available:

```sh
npm install -g @abitat_reece/cli
```

## Use

```sh
abitat iphone
```

The command starts the packaged host daemon in local-control mode, connects the Mac outbound to the `workspace.abitat.io` relay, prints a QR/manual pairing payload with a relay id, and bridges encrypted iPhone requests to the Mac's Codex app-server. The iPhone only needs the Abitat app.

Other endpoint modes are available when you want them:

```sh
abitat iphone --transport local
abitat iphone --transport tailscale
abitat iphone --transport temporary-tunnel
abitat iphone --transport quick-tunnel
abitat iphone --transport manual --endpoint https://your-endpoint.example
```

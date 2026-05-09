# Abitat CLI

`abitat` starts a Mac-local control server so a paired iPhone can control Codex through that Mac. The CLI installs `@abitat_reece/host-daemon` as a dependency and launches it directly; core iPhone control does not require `workspace.abitat.io` or a hosted database.

## Install

```sh
brew tap Abitat/abitat
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

Install the Mac-side tunnel helper:

```sh
brew install cloudflared
```

## Use

```sh
abitat iphone
```

The command starts the packaged host daemon in local-control mode, starts a Cloudflare Quick Tunnel from the Mac, prints a QR/manual pairing payload with the generated `trycloudflare.com` URL, and bridges iPhone requests to the Mac's Codex app-server. The iPhone only needs the Abitat app.

Other endpoint modes are available when you want them:

```sh
abitat iphone --transport local
abitat iphone --transport tailscale
abitat iphone --transport manual --endpoint https://your-endpoint.example
```

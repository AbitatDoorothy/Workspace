# Public Release

## NPM Packages

Publish in dependency order:

```sh
pnpm --filter @abitat_reece/shared build
pnpm --filter @abitat_reece/shared publish --access public

pnpm --filter @abitat_reece/host-daemon build
pnpm --filter @abitat_reece/host-daemon publish --access public

pnpm --filter @abitat_reece/cli build
pnpm --filter @abitat_reece/cli publish --access public
```

`pnpm pack` and `pnpm publish` rewrite workspace dependencies to the package version, so the published packages resolve as:

- `@abitat_reece/cli -> @abitat_reece/host-daemon`
- `@abitat_reece/host-daemon -> @abitat_reece/shared`

Run the local release smoke first:

```sh
pnpm smoke:public-install
pnpm test:homebrew
```

## Cloudflare Relay

The relay Worker lives in `apps/relay` and should be deployed to Cloudflare before shipping relay-mode clients:

```sh
pnpm --filter @abitat_reece/relay test
pnpm --filter @abitat_reece/relay typecheck
pnpm --filter @abitat_reece/relay exec wrangler whoami
pnpm --filter @abitat_reece/relay exec wrangler deploy
curl https://workspace.abitat.io/relay/health
```

The relay is intentionally not a hosted workspace database. It only routes encrypted envelopes between a phone and the Mac connected to the matching relay id.

## Homebrew

The formula source lives at `Formula/abitat.rb` and installs the published `@abitat_reece/cli` npm tarball with `node@22`. It declares Python as a build dependency because the packaged host daemon includes the native `node-pty` dependency. Off-network iPhone control uses the Abitat relay by default, so `cloudflared` is not a Homebrew dependency.

For the first public Homebrew release:

1. Create or use the public GitHub owner `AbitatDoorothy`.
2. Create or use the public tap repository named `AbitatDoorothy/homebrew-abitat`.
3. Copy `Formula/abitat.rb` into that repository.
4. Publish the npm packages listed above.
5. Download the published `@abitat_reece/cli` tarball and update the formula `sha256` if it differs from the local `pnpm pack` output.
6. Test the tap locally:

```sh
brew install --build-from-source ./Formula/abitat.rb
abitat doctor
```

Users can then install with:

```sh
brew tap AbitatDoorothy/abitat
brew install abitat
```

If the formula is later accepted into Homebrew core, users can install with `brew install abitat`.

## Hosted Web

Hosted web deployment is optional for dashboard development and legacy hosted flows. Core iPhone control uses `workspace.abitat.io` only as a relay; it does not depend on a hosted database.

## iPhone App

Ship a TestFlight or App Store build with the local-first pairing screen. The app should pair from the QR/manual payload printed by `abitat iphone`.

## User Flow

After release, a new user can:

```sh
brew tap AbitatDoorothy/abitat
brew install abitat
abitat doctor
abitat iphone
```

Then they open the iPhone app and scan the QR code printed by the Mac. The phone and Mac can be on different networks because the Mac connects outbound to the Abitat relay and embeds the relay id in the pairing payload.

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

## Homebrew

The formula source lives at `Formula/abitat.rb` and installs the published `@abitat_reece/cli` npm tarball with `node@22`. It also declares Python as a build dependency because the packaged host daemon includes the native `node-pty` dependency.

For the first public Homebrew release:

1. Create or use a public GitHub organization named `Abitat`.
2. Create a public tap repository named `Abitat/homebrew-abitat`.
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
brew tap Abitat/abitat
brew install abitat
```

If the formula is later accepted into Homebrew core, users can install with `brew install abitat`.

## Hosted Web

Deploy `apps/web` to `https://workspace.abitat.io` with the environment in `docs/hosting.md`, then apply the Prisma migrations.

## iPhone App

Ship a TestFlight or App Store build with the API URL defaulting to `https://workspace.abitat.io`.

## User Flow

After release, a new user can:

```sh
brew tap Abitat/abitat
brew install abitat
abitat iphone
```

Then they register or log in at `workspace.abitat.io`, open the iPhone app, and pair with the hosted dashboard. The phone and Mac can be on different networks because both communicate through the hosted API.

#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const cliPackage = JSON.parse(await readFile(join(root, "apps/cli/package.json"), "utf8"));
const formula = await readFile(join(root, "Formula/abitat.rb"), "utf8");
const installDocs = await readFile(join(root, "docs/install.md"), "utf8");
const onboardingDocs = await readFile(join(root, "docs/onboarding.md"), "utf8");

const version = cliPackage.version;
const npmTarballUrl = `https://registry.npmjs.org/@abitat_reece/cli/-/cli-${version}.tgz`;

for (const expected of [
  "class Abitat < Formula",
  'desc "Remote Codex control from Mac and iPhone"',
  'homepage "https://github.com/AbitatDoorothy/Workspace"',
  `url "${npmTarballUrl}"`,
  'depends_on "node@22"',
  'depends_on "cloudflared"',
  'depends_on "python" => :build',
  "std_npm_args",
  'bin.install_symlink libexec/"bin/abitat"',
  'ENV["ABITAT_CLI_CONFIG_PATH"] = testpath/"config.json"',
  'assert_match "Local iPhone control does not require an Abitat hosted login.", shell_output("#{bin}/abitat doctor")'
]) {
  if (!formula.includes(expected)) {
    throw new Error(`Expected Formula/abitat.rb to include ${expected}`);
  }
}

const shaMatch = formula.match(/sha256 "([a-f0-9]{64})"/u);
if (!shaMatch) {
  throw new Error("Expected Formula/abitat.rb to include a 64-character sha256");
}

for (const expected of [
  "brew tap AbitatDoorothy/abitat",
  "brew install abitat",
  "brew install cloudflared",
  "abitat iphone",
  "Install the Abitat iPhone app"
]) {
  if (!installDocs.includes(expected)) {
    throw new Error(`Expected docs/install.md to include ${expected}`);
  }
}

for (const expected of [
  "# Abitat User Onboarding",
  "brew tap AbitatDoorothy/abitat",
  "brew install abitat",
  "brew install cloudflared",
  "abitat iphone",
  "Cloudflare Quick Tunnel"
]) {
  if (!onboardingDocs.includes(expected)) {
    throw new Error(`Expected docs/onboarding.md to include ${expected}`);
  }
}

console.log(`validated Homebrew formula for @abitat_reece/cli ${version}`);

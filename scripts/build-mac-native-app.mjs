#!/usr/bin/env node

import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = resolve(rootDir, "apps/mac-native");
const hostHelperPath = resolve(rootDir, "apps/host-daemon/dist/cli/index.js");
const nodeBinaryPath = process.execPath;
execFileSync("swift", ["build", "-c", "release", "--package-path", packagePath], {
  cwd: rootDir,
  stdio: "inherit"
});
const binPath = execFileSync(
  "swift",
  ["build", "--show-bin-path", "-c", "release", "--package-path", packagePath],
  { cwd: rootDir, encoding: "utf8" }
).trim();
const builtExecutable = resolve(binPath, "AbitatMac");
const appPath = resolve(rootDir, "apps/mac-native/dist/Abitat.app");
const contentsPath = resolve(appPath, "Contents");
const macosPath = resolve(contentsPath, "MacOS");
const resourcesPath = resolve(contentsPath, "Resources");
const launcherPath = resolve(macosPath, "AbitatMac");
const bundledExecutablePath = resolve(macosPath, "AbitatMac.bin");

await rm(appPath, { force: true, recursive: true });
await mkdir(macosPath, { recursive: true });
await mkdir(resourcesPath, { recursive: true });
await cp(builtExecutable, bundledExecutablePath);
await chmod(bundledExecutablePath, 0o755);

await writeFile(
  launcherPath,
  `#!/bin/sh
export ABITAT_DESKTOP_HELPER_PATH="${hostHelperPath}"
export ABITAT_NODE_BINARY_PATH="${nodeBinaryPath}"
export PATH="$(dirname "${nodeBinaryPath}"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
exec "$(dirname "$0")/AbitatMac.bin"
`,
  "utf8"
);
await chmod(launcherPath, 0o755);

await writeFile(
  resolve(contentsPath, "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Abitat</string>
  <key>CFBundleExecutable</key>
  <string>AbitatMac</string>
  <key>CFBundleIdentifier</key>
  <string>io.abitat.mac</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Abitat</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`,
  "utf8"
);

console.log(`Created ${appPath}`);

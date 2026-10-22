#!/usr/bin/env bash
# Builds the fork's macOS DMGs (Apple Silicon and Intel) and the remote host
# packages on a Mac. Run on the Mac, in a checkout of the release commit:
#   scripts/build/build-mac.sh
# Output is collected in build/release-artifacts/ for upload to the release.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

rustup target add aarch64-apple-darwin x86_64-apple-darwin
# Dependencies are prepared separately; local installs use update-local.sh.

for target in aarch64-apple-darwin x86_64-apple-darwin; do
  pnpm exec tauri build --target "$target" --bundles app,dmg \
    --config src-tauri/tauri.fork.macos.conf.json
done

# Remote (SSH) projects download these for the app's own version.
pnpm run host:package --all

out=build/release-artifacts
rm -rf "$out"
mkdir -p "$out"
cp target/*-apple-darwin/release/bundle/dmg/*.dmg "$out/"
cp build/host-packages/*.tar.gz build/host-packages/*.zip build/host-packages/*.sha256 "$out/"
ls -l "$out"

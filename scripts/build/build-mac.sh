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

# Host packages first: each app bundles its own architecture's archive, and
# remote (SSH) projects download them for the app's own version.
pnpm run host:package --all

# Optional stable signing identity (a Developer ID Application certificate in
# the keychain, or a local self-signed code-signing certificate). Without it
# the app is ad-hoc signed and macOS forgets its privacy grants on every build.
sign_config=()
if [ -n "${BYCODA_MACOS_SIGNING_IDENTITY:-}" ]; then
  sign_config=(--config "{\"bundle\":{\"macOS\":{\"signingIdentity\":\"${BYCODA_MACOS_SIGNING_IDENTITY}\"}}}")
fi

for target in aarch64-apple-darwin x86_64-apple-darwin; do
  case "$target" in
    x86_64-*) config=src-tauri/tauri.fork.macos-x64.conf.json ;;
    *) config=src-tauri/tauri.fork.macos.conf.json ;;
  esac
  pnpm exec tauri build --target "$target" --bundles app,dmg --config "$config" ${sign_config[@]+"${sign_config[@]}"}
done

out=build/release-artifacts
rm -rf "$out"
mkdir -p "$out"
cp target/*-apple-darwin/release/bundle/dmg/*.dmg "$out/"
cp build/host-packages/*.tar.gz build/host-packages/*.zip build/host-packages/*.sha256 "$out/"
ls -l "$out"

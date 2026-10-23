set -eu
umask 077
BASE="$HOME/.bycoda-host"
ENTRY="$BASE/bin/bycoda-host"
VERSION=@@VERSION@@
RELEASE=@@RELEASE@@
EXISTED=0
[ -x "$ENTRY" ] && EXISTED=1
FORCE_UPGRADE=${BYCODA_HOST_FORCE_UPGRADE:-0}
HOST_PORT=${BYCODA_HOST_PORT:-3776}
# A package shipped inside the desktop installer, verified like a download.
ARCHIVE=${BYCODA_HOST_ARCHIVE:-}

if [ ! -x "$ENTRY" ] || [ "$FORCE_UPGRADE" = 1 ]; then
  [ -n "$ARCHIVE" ] || [ -n "$RELEASE" ] || { echo 'bycoda host distribution is not configured. Set BYCODA_HOST_RELEASE_URL when building the desktop, or install an bycoda host package manually.' >&2; exit 1; }
  case "$(uname -s)" in Darwin) OS=darwin ;; Linux) OS=linux ;; *) echo 'bycoda Host supports Linux and macOS.' >&2; exit 1 ;; esac
  case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64|amd64) ARCH=x64 ;; *) echo 'Unsupported host architecture.' >&2; exit 1 ;; esac
  FILE="bycoda-host-$OS-$ARCH.tar.gz"
  mkdir -p "$BASE/runtime" "$BASE/bin"
  TMP=$(mktemp -d "$BASE/runtime/.install.XXXXXXXX")
  trap 'rm -rf "$TMP"' EXIT
  trap 'exit 130' HUP INT TERM
  download() {
    if command -v curl >/dev/null 2>&1; then
      curl --proto '=https' --proto-redir '=https' -fLsS --connect-timeout 15 --max-time 180 "$1" -o "$2"
    elif command -v wget >/dev/null 2>&1; then
      wget --https-only --timeout=180 -q -O "$2" "$1"
    else
      echo 'Install curl or wget on this host and reconnect.' >&2; exit 1
    fi
  }
  if [ -n "$ARCHIVE" ]; then
    cp "$ARCHIVE" "$TMP/$FILE" && cp "$ARCHIVE.sha256" "$TMP/checksum" || { echo 'The bundled bycoda Host package is missing.' >&2; exit 1; }
  elif ! download "$RELEASE/$FILE" "$TMP/$FILE" || ! download "$RELEASE/$FILE.sha256" "$TMP/checksum"; then
    echo "The bycoda Host package for version $VERSION is unavailable. Install a bycoda release that includes host packages." >&2; exit 1
  fi
  EXPECTED=$(awk 'NR == 1 {print $1}' "$TMP/checksum")
  case "$EXPECTED" in *[!0-9a-f]*|'') echo 'Invalid host package checksum.' >&2; exit 1 ;; esac
  [ "${#EXPECTED}" -eq 64 ] || exit 1
  if command -v shasum >/dev/null 2>&1; then
    ACTUAL=$(shasum -a 256 "$TMP/$FILE" | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    ACTUAL=$(sha256sum "$TMP/$FILE" | awk '{print $1}')
  else
    echo 'Install shasum or sha256sum on this host and reconnect.' >&2; exit 1
  fi
  [ "$EXPECTED" = "$ACTUAL" ] || { echo 'bycoda Host package checksum mismatch.' >&2; exit 1; }
  mkdir "$TMP/unpacked"
  tar -xzf "$TMP/$FILE" -C "$TMP/unpacked"
  [ "$("$TMP/unpacked/bycoda-host" --version)" = "$VERSION" ] || { echo 'bycoda Host version mismatch.' >&2; exit 1; }
  DEST="$BASE/runtime/$VERSION-$OS-$ARCH-$(basename "$TMP")"
  # Concurrent installations never replace a directory used by a running host.
  mv "$TMP/unpacked" "$DEST"
  [ "$("$DEST/bycoda-host" --version)" = "$VERSION" ] || exit 1
  # Keep a real wrapper (rather than a symlink): it resolves the packaged Node
  # relative to the versioned executable, not this bin directory.
  printf '%s\n' "$DEST" > "$TMP/runtime-path"
  mv "$TMP/runtime-path" "$BASE/runtime-path"
  cat > "$TMP/launcher" <<'SH'
#!/bin/sh
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUNTIME=$(cat "$BASE/runtime-path")
exec "$RUNTIME/bycoda-host" "$@"
SH
  chmod 700 "$TMP/launcher"
  mv "$TMP/launcher" "$ENTRY"
fi

if [ "$EXISTED" = 1 ] && { [ "$FORCE_UPGRADE" = 1 ] || [ "${BYCODA_HOST_REPAIR:-0}" = 1 ]; }; then
  "$ENTRY" service uninstall >/dev/null
fi
"$ENTRY" service install --port "$HOST_PORT" >/dev/null
"$ENTRY" connection-info
# Every install unpacks a fresh runtime (with its Node engine) beside the old
# ones. Now that the new host answers, drop the others, except a runtime that a
# registered service definition still launches and installs still in progress.
RUNTIME=$(cat "$BASE/runtime-path")
REGISTERED=$(cat "$HOME/Library/LaunchAgents/com.bycoda.host.plist" "$HOME/.config/systemd/user/bycoda-host.service" 2>/dev/null || true)
for OLD in "$BASE"/runtime/*/; do
  OLD=${OLD%/}
  [ -d "$OLD" ] || continue
  [ "$OLD" != "$RUNTIME" ] || continue
  case "$REGISTERED" in *"$(basename "$OLD")"*) continue ;; esac
  rm -rf "$OLD" || true
done

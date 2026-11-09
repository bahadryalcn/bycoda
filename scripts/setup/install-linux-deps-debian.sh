#!/usr/bin/env bash
set -euo pipefail

# Hosted runners include unrelated third-party repositories. CI can select the
# distribution's own source file without editing the machine's apt config.
APT_SOURCES=()
SOURCE_FILE=""
HTTPS_FALLBACK=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --sources)
      if [ "$#" -lt 2 ] || [ ! -f "$2" ]; then echo "--sources requires an existing source file" >&2; exit 1; fi
      SOURCE_FILE="$2"
      APT_SOURCES=(-o "Dir::Etc::sourcelist=$SOURCE_FILE" -o "Dir::Etc::sourceparts=-")
      shift 2 ;;
    --https-mirror-fallback) HTTPS_FALLBACK=true; shift ;;
    *) echo "Usage: $0 [--sources EXISTING_SOURCE_FILE] [--https-mirror-fallback]" >&2; exit 1 ;;
  esac
done

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This helper currently supports Ubuntu/Debian systems with apt-get." >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  SUDO=()
elif command -v sudo >/dev/null 2>&1; then
  SUDO=(sudo)
else
  echo "sudo is required when not running as root." >&2
  exit 1
fi

# The conditional expansions also support empty arrays with nounset on Bash 3.
FALLBACK_FILE=""
cleanup() { if [ -n "$FALLBACK_FILE" ]; then rm -f -- "$FALLBACK_FILE"; fi; }
trap cleanup EXIT
APT_NETWORK=(-o Acquire::Retries=1 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20)
fallback_sources() {
  if [ "$HTTPS_FALLBACK" != true ] || [ -n "$FALLBACK_FILE" ]; then return 1; fi
  if [ -z "$SOURCE_FILE" ]; then
    echo "HTTPS fallback requires an explicit Ubuntu source file; system sources were not changed" >&2
    return 1
  fi
  # Retry once, only after a real update failure. Keep signed repository policy
  # and distribution suites; never rewrite /etc/apt or disable certificate checks.
  FALLBACK_FILE=$(mktemp "${TMPDIR:-/tmp}/bycoda-apt-XXXXXX.sources")
  sed -E \
    -e 's#http://([A-Za-z0-9.-]+\.)?archive\.ubuntu\.com/ubuntu#https://archive.ubuntu.com/ubuntu#g' \
    -e 's#http://security\.ubuntu\.com/ubuntu#https://security.ubuntu.com/ubuntu#g' \
    -e 's#http://ports\.ubuntu\.com/ubuntu-ports#https://ports.ubuntu.com/ubuntu-ports#g' \
    "$SOURCE_FILE" > "$FALLBACK_FILE"
  if cmp -s "$SOURCE_FILE" "$FALLBACK_FILE"; then
    echo "No supported Ubuntu HTTP mirror to replace; fallback refused" >&2
    return 1
  fi
  APT_SOURCES=(-o "Dir::Etc::sourcelist=$FALLBACK_FILE" -o "Dir::Etc::sourceparts=-")
  echo "APT download failed; retrying once with a temporary HTTPS Ubuntu mirror" >&2
}
apt_update() { ${SUDO[@]+"${SUDO[@]}"} apt-get "${APT_NETWORK[@]}" ${APT_SOURCES[@]+"${APT_SOURCES[@]}"} update; }
if apt_update; then :; else
  first_status=$?
  fallback_sources || exit "$first_status"
  apt_update
fi
PACKAGES=(build-essential curl file libayatana-appindicator3-dev libgtk-3-dev libssl-dev libwebkit2gtk-4.1-dev libxdo-dev librsvg2-dev patchelf wget)
apt_install() { ${SUDO[@]+"${SUDO[@]}"} env DEBIAN_FRONTEND=noninteractive apt-get "${APT_NETWORK[@]}" ${APT_SOURCES[@]+"${APT_SOURCES[@]}"} install -y "${PACKAGES[@]}"; }
if apt_install; then :; else
  first_status=$?
  fallback_sources || exit "$first_status"
  apt_update
  apt_install
fi

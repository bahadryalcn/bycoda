# bycoda product identity

bycoda was originally built on [MonoCode](https://github.com/hardbeat920/monocode)
v0.6 by [Nick (hardbeat920)](https://github.com/hardbeat920) and is developed independently.
The MIT license, copyright notices, and upstream contribution attribution are preserved.

| Setting                         | bycoda                     |
| ------------------------------- | -------------------------- |
| Visible name and installer name | bycoda                     |
| Bundle identifier               | `com.bycoda.desktop`       |
| Development identifier          | `com.bycoda.desktop.dev`   |
| Windows installation directory  | `%LOCALAPPDATA%\bycoda`    |
| macOS bundle                    | `/Applications/bycoda.app` |
| Host directory                  | `~/.bycoda-host`           |
| macOS host service              | `com.bycoda.host`          |
| Linux host service              | `bycoda-host.service`      |
| Windows host task               | `Bycoda Host-<SID>`        |
| Default host port               | `3776`                     |

Existing services, credentials, and user data are not migrated automatically.
Desktop data lives under `%APPDATA%\com.bycoda.desktop` on Windows and
`~/Library/Application Support/com.bycoda.desktop` on macOS. The executable is
`bycoda.exe` / `bycoda`. The Rust crate, browser storage keys, events, host output, and
internal agent protocol now use `bycoda`. Older browser preferences and protocol
fields are not automatically imported. Use matching desktop and host versions;
older installations and their data are left intact.

Use the [shared coordinator](../local-update.md) for local Windows/macOS builds and
installation. Installers are archived in `~/.bycoda-build/packages/`.

## Releases and updates

Installed `com.bycoda.desktop` apps check
`https://github.com/bahadryalcn/bycoda/releases/latest/download/latest.json`
every 30 minutes and offer signed updates. Development identities never check.
Failed automatic checks stay quiet; manual checks report the error.

To publish a release:

1. Run `pnpm run set-version <x.y.z>` with a version greater than every installed
   version, and add a `## [<x.y.z>]` section to `CHANGELOG.md`.
2. Commit, then push a `v<x.y.z>` tag. `.github/workflows/release.yml` checks the
   tag against `package.json` and the changelog, builds the Windows NSIS installer
   and the Apple Silicon app/DMG, and uploads signed updater artifacts and
   `latest.json` to a **draft** release.
3. Review the draft: `latest.json` must list both `windows-x86_64` and
   `darwin-aarch64` with signatures. Then publish it. Installed apps see the
   update only after publishing.

The updater public key is in the Tauri configuration. The private key and its
password exist only in the maintainer's `~/.tauri/bycoda-updater.key*` files and
the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository
secrets. Losing the private key means installed apps can no longer be updated.
Local coordinator builds remain unsigned and never create updater artifacts.

The updater replaces only the desktop app. Hosts are updated separately. macOS
builds are ad-hoc signed and not notarized, so Gatekeeper blocks a first manual
DMG install on another Mac until Developer ID signing is configured.

Source checks do not prove that packaged applications are installed or host
services work. Verify real builds and installation separately.

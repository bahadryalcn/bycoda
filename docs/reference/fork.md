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

Releases are not published by pushing a tag. The owner prepares an exact-source
candidate and then explicitly dispatches **Prepare or publish reviewed candidate**
(`.github/workflows/release-publish.yml`), which publishes only after revalidating
the candidate, packages and updater signatures. Version bumps use
`pnpm run set-version <x.y.z>` plus a `## [<x.y.z>]` changelog section. Channels,
required evidence and the publish procedure are in
[release operations](releases.md#packages-and-owner-publication).

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

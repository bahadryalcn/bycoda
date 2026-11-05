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
builds are ad-hoc signed and not notarized unless the Apple secrets below are set,
so Gatekeeper blocks a first manual DMG install on another Mac and macOS forgets
privacy grants (microphone, screen recording, folders) after every update.

### macOS Developer ID signing and notarization

Stable tag builds sign and notarize the macOS app when these repository secrets
exist; without them the build stays ad-hoc so forks still work. Nightly and
preview candidates never receive signing secrets and stay ad-hoc.

1. Enroll in the Apple Developer Program and create a **Developer ID
   Application** certificate (Xcode > Settings > Accounts > Manage Certificates,
   or developer.apple.com > Certificates).
2. Export it from Keychain Access as `.p12` with a password, then
   `base64 -i cert.p12 | pbcopy`.
3. Add secrets: `APPLE_CERTIFICATE` (that base64), `APPLE_CERTIFICATE_PASSWORD`,
   `APPLE_SIGNING_IDENTITY` (for example `Developer ID Application: Name (TEAMID)`,
   from `security find-identity -v -p codesigning`).
4. For notarization add either `APPLE_API_KEY` (key ID), `APPLE_API_ISSUER` and
   `APPLE_API_PRIVATE_KEY` (the `.p8` contents) from App Store Connect, or
   `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`.

`.github/workflows/desktop-package.yml` imports only complete groups, passes them
through masked environment variables and never prints them. The app's
`Entitlements.plist` and `Info.plist` usage strings then apply under the hardened
runtime. The bundled Host is a separate download extracted at runtime: its Node
binary is the Node.js-signed official build. The `agent-desktop` helper
(`agent-desktop` and `agent-desktop-macos-helper`, two bare Mach-O executables, not
an app bundle) needs Accessibility and Screen Recording, so `host/package.mjs`
signs each with the same identity (`BYCODA_MACOS_SIGNING_IDENTITY`, falling back to
`APPLE_SIGNING_IDENTITY`) using `codesign --force --timestamp --options runtime`
and the stable identifiers `com.bycoda.desktop.agent-desktop` and
`com.bycoda.desktop.agent-desktop-macos-helper`, then verifies with
`codesign --verify --strict` and reads back identifier, authority and hardened
runtime (`scripts/release/sign-desktop-helper.mjs`). It signs only the package copy
on a macOS machine, records a `macos-codesign` receipt and the signed hashes in the
helper manifest, and refuses to sign twice. The `package` job in
`desktop-package.yml` imports the certificate into a temporary keychain before
packaging. Without an identity, or when packaging darwin targets on Linux
(`host-packages` job), the helper stays ad-hoc signed and `host/package.mjs` prints a
notice. The first signed Host update changes the helper's identity once, so grant
Accessibility and Screen Recording again once; later updates keep the grants.

Local macOS builds: set `BYCODA_MACOS_SIGNING_IDENTITY` to a certificate in the
login keychain (a Developer ID, or a self-signed code-signing certificate created
in Keychain Access > Certificate Assistant) for `scripts/build/build-mac.sh` and
`scripts/update-local.sh`. A stable identity keeps privacy grants across rebuilds.
Local builds are never notarized.

Source checks do not prove that packaged applications are installed or host
services work. Verify real builds and installation separately.

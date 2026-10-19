# Local Windows and macOS updates

Use the shared coordinator for every local app/host update. From the Windows checkout:

```powershell
.\scripts\update-local.ps1 -Plan
.\scripts\update-local.ps1
```

Pass `-Version <version>` only when changing the version. The coordinator freezes
one source snapshot and builds Windows and the configured macOS SSH machine in
parallel. It does not switch branches, commit, push, or publish a release. Local
scratch files, documentation, and Python bytecode are excluded from build snapshots.

## Prerequisites and machine configuration

Python 3.12+, Node.js, the packageManager-pinned pnpm version, Rust, Tauri platform
prerequisites, and the host tools must already be installed. The coordinator does
not install additional system tools.

Review `scripts/local-update/local-update.config.json` before use. The checked-in values are
placeholder defaults, not discovered machines: `mac-builder` must resolve through
your SSH configuration, the remote Python path must exist, and Cargo target paths
must match your checkout. Put machine-specific values in the ignored
`scripts/local-update/local-update.local.json`; its sections override the defaults
key by key. No SSH credentials belong in either file.

Use `-Platforms windows` or `-Platforms mac` to select one machine. From a macOS
checkout, use `sh scripts/update-local.sh` for a macOS-only update.

## Commands and selection

```powershell
.\scripts\update-local.ps1 -Plan
.\scripts\update-local.ps1 -BuildOnly
.\scripts\update-local.ps1 -InstallOnly
.\scripts\update-local.ps1 -Status
```

`-Plan` reviews the selected machines and options without building or installing.
`-BuildOnly` builds and validates app/host packages without starting installers;
the macOS equivalent is `sh scripts/update-local.sh --build-only`.
`-InstallOnly` reuses this pipeline's last package without copying or rebuilding
source. It cannot be combined with `-BuildOnly`.

Use `-Components host` or `-Components app` to install only that component;
both are selected by default. Host and app installation have independent idle gates.

When another session is editing the checkout, apply only completed files to a
verified earlier snapshot with
`-BaseSnapshot <coordinator-request.json> -SourcePaths host/device-host.ts,host/device-host.test.ts`.
The archive checksum and fingerprint are checked before applying the selected
repository paths. This option cannot be combined with `-SnapshotRequest`,
`-InstallOnly`, or a version change.

## Build reuse and caches

- The persistent source directory is `~/.bycoda-build/source`. It uses real
  `node_modules`; new directories or junctions are not created for every run.
- Existing dependencies are reused unless `package.json` changes. Missing
  `node_modules` requires an initial install. A package change triggers
  `pnpm install --frozen-lockfile --prefer-offline` in the managed build directory.
  Lockfile-only changes, missing build artifacts, and `-ForceBuild` do not force
  dependency installation.
- `verifyDepsBeforeRun: false` prevents pnpm from automatically installing before
  `run`/`exec`; the coordinator owns installation decisions.
- Web, host, and native inputs are tracked separately. Host-only changes do not
  rebuild the web/native app. Successful stages are recorded immediately and can
  be reused after a later-stage failure.
- Web assets are built once; Tauri's duplicate `beforeBuildCommand` is skipped.
- Host Node archives use a persistent checksum-verified cache. The host stage also
  writes the distribution archive and its checksum, because release-identity
  installers bundle it; the installed app uses it to install or upgrade its own
  host. A same-version local host is left as installed by this coordinator.
- Default local mode disables LTO, uses 16 codegen units, and enables incremental
  compilation only in this command's Cargo environment. Use `-Release` for full
  optimization or `-ForceBuild` for a fresh build without forcing dependency installation.
- Cargo target directories and SSH/Python paths come from the configuration file.
  Preserve these caches. Checksums detect artifacts replaced by another build.

A new optimization configuration may need to populate its own Cargo cache.
Build duration depends on the machine and inputs; no fixed completion time is guaranteed.

## Installation and recovery

Each machine has separate hidden host and app helpers. The host waits for running
sessions in its database; the app waits for its `in_flight_sessions` records.
A database read failure means wait/recovery, never zero active sessions.

On Windows, stop the host through its lifecycle command, rather than leaving an
orphaned Node process with `Stop-ScheduledTask`. Service scripts and launchers use
one template. On macOS, update the existing LaunchAgent runtime paths. Verify the
new process path, health, and SQLite integrity; restore the previous configuration
if a service swap fails.

The shared Windows runner logs native stderr diagnostics without treating them as
termination requests; the host's exit code controls crash recovery. Runtime upgrades
regenerate this runner from the packaged host code. Normal CI covers the Windows
service tests, and the release workflow requires those tests before building app
installers or uploading host packages, including consecutive runtime upgrades and
recovery from an exited host whose state file remains.

If the registered Windows host PID has already exited, installation may proceed
after idle database and stopped-service checks. If the PID still runs, a lifecycle
failure blocks installation. A connection error is not evidence that the host is idle.

Database backups have a 15-second limit and release their connections. The app
closes after its active turn ends. Verify the macOS bundle signature/version,
Windows installer checksum, and installed binary against the built artifact.
Keep rollback files. This local pipeline does not notarize macOS bundles.

Windows app updates snapshot the complete installation directory under the package's
`rollback-app/installation/`, with file hashes in `windows-installation-hashes.json`.
If setup or executable verification fails, the helper stops the replacement,
restores and verifies that directory, and restarts the old app only if it was running
before the update. The update remains failed. The failed installation is retained
on the installation volume; `rollback-app/windows-recovery.json` records its path.
App databases are preserved, not rolled back. Installer registry metadata, shortcuts
and system dependencies are outside this file rollback and may require installer
repair; neither a file rollback nor the synthetic tests prove a real installer repair.

macOS staging and rollback bundles stay on the Applications volume under
`/Applications/.bycoda-update.noindex/<package-id>/` as `staged.bundle` and
`previous.bundle`. Only the active `/Applications/bycoda.app` has an `.app`
extension in the Applications list. Preserve this hidden recovery directory;
do not put rollback copies back in Applications as additional `.app` bundles.

A pending helper for another package, or a running legacy installer helper, blocks
a new update on that machine before building. Let existing work finish; do not kill
active processes to accelerate installation.

## Package archive

Every successful build also copies its package to one fixed folder,
`~/.bycoda-build/packages/`, named by version and build date:
`bycoda_<version>_<YYYY-MM-DD>_x64-setup.exe` on Windows and
`bycoda_<version>_<YYYY-MM-DD>_aarch64.app` on macOS. An identical same-day package
is reused; a different one gets a `_2`, `_3`, ... suffix. Existing files are never
overwritten. The coordinator prints the archived path. Running the Windows setup
by hand updates only the app; use `-InstallOnly` to update the host as well.

Logs, stage timings, immutable payloads, and manifests live at
`~/.bycoda-build/runs/<source-id>-<mode>/`. Installation status lives at
`~/.bycoda-host/update-jobs/{host,app}.json`. `-Status` reads both machines.
The macOS build log is `.bycoda-build/mac-<id>.log` under the coordinator's home.
Helpers can continue after the command returns: **scheduled does not mean installed**.

## Checks without building

```powershell
python -B scripts/local-update/test_local_update.py
.\scripts\update-local.ps1 -Plan
```

These validate the scripts and plan without starting a build, installation, or SSH
session. They do not establish actual build or end-to-end installation acceptance.

Local updates and CI use `pnpm-lock.yaml`. `package-lock.json` is retained for the
existing version script and legacy metadata; it does not drive installation.

## Installation identity and publishing

The visible package name is `bycoda`; development uses `bycoda Dev`.
Identifiers remain `com.bycoda.desktop` and `com.bycoda.desktop.dev` to preserve data.
Windows installs to `%LOCALAPPDATA%\bycoda`; macOS installs to
`/Applications/bycoda.app`. The executable is `bycoda.exe` / `bycoda`, while the Rust
crate is `bycoda`. The coordinator checks `mainBinaryName` before installation.

The host uses `~/.bycoda-host`, services `com.bycoda.host` / `bycoda-host.service`,
Windows task `Bycoda Host-<SID>`, port `3776`, and launcher `bycoda-host(.cmd)`.
Existing installations and data are preserved; there is no automatic migration.
Internal database names remain for compatibility.

If session data was transferred before the first app install, the coordinator
waits for the database to be idle and backs it up. It does not require rollback
copies for a binary/bundle that has never existed. A missing database for an existing
service/bundle is a recovery condition, not an idle state.

Package manifests carry the independent product identity. `-InstallOnly` rejects
legacy or mismatched packages; build a matching package instead.
Local packages are unsigned and do not create updater artifacts; no upstream
feed or signing key is reused. Installed apps check the signed GitHub release feed
described in [the release reference](reference/fork.md#releases-and-updates).
Local installation does not authorize public publishing.

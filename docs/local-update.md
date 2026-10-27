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

## Worktree source and build provenance

Run the coordinator from the owner-selected source worktree. Project identity and
execution path differ: a change committed on a session branch is not automatically
included in an integration checkout or its next package. Do not switch branches,
merge, copy another workspace's dirty files, or start installation to resolve that
difference. Builds and installation remain owner-directed.

Before diagnosing a screenshot, compare the requested source/workspace against the
build actually displayed and the responsive running Host. The managed-workspace
build contract records repository, branch, HEAD, source fingerprint, dirty paths,
component identities and included source/delivery references; see
[Managed workspaces](reference/managed-workspaces.md). `build:status` is the planned
comparison command owned by the development-environment stream; it is not available
on the contracts baseline. Use it only when the integrated package provides it.
Without a build stamp or comparison capability, report **source identity unknown**.
Equal versions, an earlier completion time, or a successful package build do not
prove that a particular commit is installed or running.

Keep requested-source, packaged, installed, responsive Host and pending-install
status separate in reports. `-Status` and the coordinator's recorded artifacts
establish update stage completion; a scheduled update is not a completed install.
Preserve separate Host/app idle gates, persistent caches, databases, credentials
and rollback files. Never print raw authentication state for provenance checks.

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
- Web, host, and native inputs are tracked separately. Host-only changes reuse
  the web build and trigger app packaging so its bundled host matches the new
  host package; Cargo can reuse unchanged native compilation. Successful stages
  are recorded immediately and can be reused after a later-stage failure.
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

Windows helpers launch through the local current-user WMI broker so closing the
desktop does not terminate its updater. The broker verifies the same user and
interactive session, uses hidden processes, and creates no scheduled task or stored
credential. A keyed launch receipt must be verified before installation starts.
Status projects an unfinished helper whose known PID has exited as `interrupted`,
retaining its recorded phase. An unknown launch without a verified PID requires
inspection and is not automatically repeated.

`-InstallOnly` can resume the same interrupted Windows package when the preserved
rollback installation passes its saved full-tree hashes and the current installation
still matches that complete old tree. Partial, changed or corrupt installations and
unverified rollback/database backups require recovery; the coordinator never
overwrites the preserved installation snapshot to force a retry.

On Windows, stop the host through its lifecycle command, rather than leaving an
orphaned Node process with `Stop-ScheduledTask`. Service scripts and launchers use
one template. On macOS, update the existing LaunchAgent runtime paths. Verify the
new process path, health, and SQLite integrity; restore the previous configuration
if a service swap fails.

Host services use a stable executable: `~/.bycoda-host/engine/node.exe` on Windows
and `~/.bycoda-host/engine/node` on macOS and Linux. `host.mjs` stays in its
versioned package. Service setup and the macOS local updater reuse identical
Node bytes and atomically replace changed engines after unloading the service.
The macOS updater restores the previous engine along with its service definition
if health checks fail. Windows also refuses to overwrite a locked engine.

This preserves the executable path used by application firewall rules across
bycoda updates. The first migration from a versioned Node path may prompt once.
Changing Node itself can still trigger OS checks on its signature or identity;
the stable path does not bypass macOS privacy permissions, Gatekeeper, or Linux
security policies. No firewall rules or OS permissions are added or broadened.

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
Reusing a completed host installation also checks the running host process and
database health, rather than trusting only its package files and an old job record.

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

## Real native development acceptance

Before release, exercise the real development desktop and its isolated Host with
the installed, authenticated Codex provider. This creates fake repositories and
development profiles; it does not run an installer or attach to the installed app.

```powershell
pnpm dev:native --acceptance-controls --shared-target G:/Projects/my_projects/monocode-worktrees/.cargo-target/n1
# In another terminal, use the exact dev-run.json path printed above:
pnpm acceptance:native --run <absolute-dev-run.json> --id q1
```

The shared target option is a cache root: the maintained bootstrap chooses its
toolchain/lockfile subdirectory. Native folder consent must be limited to this
checkout's `temp/local/q1/` and its generated fake worktrees. Use Full access only
inside this isolated test profile. The runner selects Codex and accepts
`--model` and `--switch-model` display names; no product provider defaults change.

The gate covers default current-checkout turns, opt-in worktree commits and
rewind/Undo, rejected admission and restart/legacy-row recovery, a model switch
with a Turkish message over 20 KiB, old-Host capability recovery, approved local
merge and safe directory removal, persisted task/automation defaults and
workspace policy inheritance. Merge already puts a workspace in terminal
`merged` state, so its separate Mark finished action is disabled. Todo tasks and
disabled automations are persisted without launching unattended work.

Use `--scenario 2` or `--scenario 3,5` to rerun selected scenarios after a fix,
with the same `--id` to retain the fake project and evidence state. The runner
stops on the first failure and exits nonzero; timeouts or missing native consent
never count as passes. `--turn-timeout 240000` sets the per-turn timeout.

Results, ordered steps, errors and a screenshot matrix at 1280/800 pixels in
light/dark are saved under `temp/verification/q1/`. Open and inspect the PNGs;
automated assertions alone do not constitute visual review. `acceptance.json`
records the native build identity and each selected scenario. An attached Vite
page can contain newer web source than the frozen native/Host executable, so
rebuild after changing native or Host code and preserve exact inclusion evidence.
Source checks, fixture tests, installed-app acceptance and publication remain
separate. The runner validates the managed run record, development profile and
native build identity before acting; installed data paths are rejected.

`node --test scripts/build/acceptance-native.test.mjs` checks the runner's
isolation validation independently of the provider and desktop.

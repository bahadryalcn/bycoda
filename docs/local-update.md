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

On Windows, if the global pnpm executable differs from the pinned version, the
worker can select an already provisioned exact-version executable from pnpm's
package-manager store. It validates package metadata and the executable, changes
only the worker's PATH, then verifies the version again. It does not install or
upgrade a global package manager; an unavailable exact version remains an error.

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

`-Components host` also limits the build to the Host: dependency preparation,
Host compile checks and Host packaging. It does not query Rust, build the web app,
or produce a desktop installer. Its immutable run directory has a `-host` suffix,
and its manifest declares only the Host component. Host archives, checksums and
manifest sidecars are retained in `~/.bycoda-build/packages/`. An app build still
packages the Host because the desktop installer bundles it.

`-InstallOnly` selects the last coordinator request and validates every requested
component before scheduling anything. After a Host-only build, use
`-Components host -InstallOnly`; requesting the app from that package is rejected.
Building or scheduling only the Host leaves another pending app package/job intact.
To select an older preserved package explicitly, use a single platform and
`-InstallOnly -SnapshotRequest <runs/.../manifest.json> -Components app` (or `host`).
The manifest selects the immutable package; no source transfer or build occurs.
An app retry must select a manifest that contains the app. This does not resolve
an unknown launch or an ambiguous installation state.

When another session is editing the checkout, apply only completed files to a
verified earlier snapshot with
`-BaseSnapshot <coordinator-request.json> -SourcePaths host/device-host.ts,host/device-host.test.ts`.
The archive checksum and fingerprint are checked before applying the selected
repository paths. This option cannot be combined with `-SnapshotRequest`,
`-InstallOnly`, or a version change.

## Build reuse and caches

- The persistent source directory is `~/.bycoda-build/source`. It uses real
  `node_modules`; new directories or junctions are not created for every run.
- Existing dependencies are reused when install inputs are unchanged. A product
  version-only change and JSON formatting do not invalidate them. Other
  `package.json` fields, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`,
  `.pnpmfile.cjs`, files under `patches/`, and workspace manifests under
  `apps/`/`packages/` are install inputs. Missing
  `node_modules` requires an initial install. An install-input change triggers
  `pnpm install --frozen-lockfile --prefer-offline` in the managed build directory.
  Missing build artifacts and `-ForceBuild` do not force dependency installation.
  Older cache markers refresh dependencies once because they did not track all
  pnpm lock/workspace inputs.
- `verifyDepsBeforeRun: false` prevents pnpm from automatically installing before
  `run`/`exec`; the coordinator owns installation decisions.
- Web, Host compilation, Host packaging, and native inputs are tracked separately.
  Host compile inputs come from every actual entrypoint in `host/build.mjs` through
  esbuild's in-memory dependency metadata, plus non-test Host resources retained
  conservatively for dynamic workers, copied guards and bundled skills. Shared
  `src/` modules are tracked through that graph, rather than every UI file. Unknown
  dynamic build configuration fails input discovery instead of accepting an
  incomplete cache key. Discovery does not write or execute Host bundles.
- Host compile reuse requires equal input/dependency fingerprints and matching
  hashes for every declared compiled output. Package-adjacent version/build
  identity is finalized in a separate Host package stage. A provenance-only change
  can reuse proven equivalent executable bytes while producing a new package
  stamped for the current frozen source. It never copies an old package's identity
  onto changed or unverified code. Cache manifests record compile-input and output
  hashes; immutable component manifests and payloads cannot be overwritten.
- For a desktop build, Host-only changes can reuse web assets but still trigger
  app packaging so the embedded Host matches. Web/native source identity remains
  part of their build keys because the desktop embeds web and native metadata;
  this change does not relabel an old desktop executable. Cargo can reuse unchanged
  native compilation. Successful stages are recorded immediately for later retries.
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

Status also reads independent Host/app idle gates afresh, in read-only mode, with
an observation time. A helper's old count is shown as `reportedActiveSessions`;
it is not current activity proof. An unreadable or absent database yields an
`unknown` idle gate. This projection never rewrites job records or repairs a DB.

An interrupted helper is not automatically relaunched by another build. Inspect
status and explicitly retry the same immutable package with `-InstallOnly` and the
appropriate `-Components`. A known exited helper interrupted before effects
(`starting`/`waiting`) may resume; the new helper still waits for its own fresh
idle gate. Unknown launch/effect states and interrupted Host mutation require
inspection. For a Windows app interrupted during installation, a retry requires
no relevant installer/helper process, a verified full rollback tree and unchanged
current old installation, plus any required valid DB backup. Partial or ambiguous
replacement is left for recovery. No active session is killed and no stale
`in_flight_sessions` row is deleted to permit a retry.

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
The desktop's automatic bundled-Host installer admits a fresh, empty profile only.
For an existing profile it cannot prove all activity owners or distinguish an
intentional stop from a failure, so it defers automatic repair and upgrades. The
owner-directed update coordinator retains its separate admission and recovery checks.

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

Local updates and CI use `pnpm-lock.yaml`; no npm lockfile is read or written.

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

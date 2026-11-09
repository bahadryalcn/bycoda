# Release candidates and artifact trust

Release work has separate source, package, smoke, publication and installation
boundaries. A green source workflow or cache hit proves neither a working package
nor an installed application. The maintained controls never publish implicitly.

## Channels and immutable selection

`scripts/release/release-candidate.mjs` accepts a full lowercase 40-character
source SHA. Every channel requires a completed successful `.github/workflows/ci.yml`
run at that SHA with exactly one successful job named `Check`. Stable and nightly
accept `push` on `main` or a `release/*` branch or an explicit full
`workflow_dispatch`; preview accepts only `main`. PR-filtered CI cannot qualify. The receipt binds repository, run
ID/attempt, job ID, URL, channel and version using SHA256; changed metadata,
missing evidence and newer CI attempts are rejected.

| Channel | Version                               | Producer                                      | Update policy                                                          |
| ------- | ------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| Stable  | Source numeric `X.Y.Z`                | Owner-created matching `vX.Y.Z` tag           | Signed; `latest.json` on the latest release after explicit publication |
| Preview | `X.Y.(Z+1)-preview.<run-id>.g<sha12>` | `preview.yml` after each green `main` CI      | Signed; automatic prerelease and `updater-feed/preview.json`           |
| Nightly | `X.Y.Z-nightly.<run-id>.g<sha12>`     | Manual candidate or opt-in six-hour scheduler | Unsigned prerelease; no updater endpoints or feed                      |

## Branches, preview and hotfixes

Development is trunk-based. When the full CI of a `main` push succeeds,
`.github/workflows/preview.yml` starts through `workflow_run` and builds exactly
that commit (`workflow_run.head_sha`, never the newer tip): the exact-source preview
receipt (the same CI `Check` evidence as stable), signed Windows and macOS packages
with the same packaged smoke as stable, and an automatic publication. A red CI
publishes nothing. A newer preview run cancels an older one, and the monotonic feed
below keeps an older commit from replacing a newer preview.

The user selects the channel in Settings > General > Updates ("Preview updates").
Every signed package is built with the stable `releases/latest/download/latest.json`
endpoint. The native `app_update_check` command (`src-tauri/src/app_update.rs`) reads
that feed, and on the preview channel also
`releases/download/updater-feed/preview.json`, and offers the newer signed release
of the two. An install that never chose follows its own version: a `-preview.`
build defaults to preview. Preview versions take the next patch number, so
`0.7.6-preview.N` updates past stable `0.7.5` and stable `0.7.6` sorts after every
`0.7.6-preview.N`; turning preview off therefore keeps the installed preview until
the next stable release overtakes it. The `g` before the SHA keeps an all-digit SHA
prefix a valid semver identifier.

Preview publication creates the `vX.Y.(Z+1)-preview.<run-id>.g<sha12>` prerelease,
then moves the rolling `updater-feed` prerelease: the new `preview.json` is uploaded
beside the old one and renamed over it, and a feed already at a newer preview is
left unchanged, so a rerun of an older run never rolls preview users back. The
newest ten published preview releases are kept; older preview releases and their
tags are deleted. Stable, nightly, drafts and the feed are never pruned.

Stable work and hotfixes: cut `release/X.Y` from `main` when a stable line needs
protection. Fix on `main` first, cherry-pick to `release/X.Y`, bump the patch
version and changelog there and tag `vX.Y.Z` on that branch. Pushes to `release/**`
run the full CI, which qualifies that exact tag. Without a release branch, tag on
`main` as before.

The release-candidate workflow runs only on trusted `main` tooling. Source SHA
may identify a different reviewed branch with an explicitly dispatched full CI.
An ephemeral CI checkout receives a version-only overlay of root package/Cargo
metadata and Tauri version. It is recorded in the frozen build stamp; source
identity is rechecked after compilation. No developer version files are changed.
The default manual channel is nightly; preview is not offered there because it
comes only from `preview.yml`. Selecting stable there creates a source receipt
only; signed stable packaging requires its matching owner-created tag.

Scheduled nightly builds are disabled unless repository variable
`BYCODA_NIGHTLY_CANDIDATES=true`. They select the latest successful full main
source and skip unchanged sources or candidates less than six hours apart.
Completed unpublished nightly artifacts count as history, alongside releases.
Manual `force-nightly` bypasses only this time/change gate. Failed or incomplete
source checks never become eligible. A rerun keeps its version; use a new
workflow run for a new immutable candidate.

## Packages and owner publication

The reusable `desktop-package.yml` builds Windows x64 and macOS arm64. Updater
signing keys are present only in the signed build step of a stable tag or a
preview run after green `main` CI; both use the same updater key. Nightly jobs do not receive
those secrets. Stable and preview macOS jobs also read the optional Apple Developer
ID and notarization secrets, because an ad-hoc identity resets macOS privacy grants
on every update. Windows Authenticode and the six standalone Host archives stay
stable-only; preview Windows packages build on hosted runners because runner
admission never accepts `workflow_run` events. Setup is in
[fork operations](fork.md#macos-developer-id-signing-and-notarization). Trusted tooling is checked out separately from
candidate source; downloaded packages are never executed by the publisher.

Each `desktop-package-<platform>` artifact has `manifest.json` and all referenced
bytes. The manifest binds source receipt, exact version/target, frozen build
identity, installer, native launcher, Host archive/runtime and SHA256 of every
file. Windows smoke launches the actual NSIS-extracted executable and embedded
Host resources, with normalized native bytes matching the compiled candidate;
the installer is never executed. The whole macOS app payload is included. Symlinks, duplicate paths,
unexpected/missing components and file/count/total-size overruns fail closed.
Stable packages include the paired updater archive and signature. Stable also
retains one `standalone-host-packages` artifact for all six existing Host targets:
Darwin/Linux/Windows, x64/arm64. Its manifest binds all archives, checksums and
per-target Host identity. Standalone target execution remains separate evidence.

Windows Host archives contain a precompiled GUI service launcher that starts the
bundled Node runtime directly. Windows packaging builds it with Rust; cross-platform
`host/package.mjs --all` requires source/hash-verified Windows x64 and arm64 bundles
under `<root>/<target>`, selected with `--host-launcher-dir <root>`. The release workflow builds those
bundles on its admitted Windows runner before the portable packaging job. Ordinary
`host:build` remains JavaScript-only. Installed Hosts never compile the launcher or
execute an encoded PowerShell service payload.

Set `BYCODA_WINDOWS_SIGNING_CERT_SHA1` to the exact code-signing certificate in the
Windows runner's certificate store and optionally `BYCODA_WINDOWS_SIGNING_STORE`
to `CurrentUser` (default) or `LocalMachine`. Stable Windows packaging signs and
verifies the service launcher, desktop helper, application and NSIS binaries with
RFC3161 timestamps. The Windows SDK SignTool and private-key access must already
exist on that runner. Without a certificate, development builds remain unsigned;
Tauri updater signatures do not establish Authenticode trust or antivirus acceptance.
Nonstable release jobs do not configure these signing identities.

Windows installer/native provenance normalizes the Tauri bundle marker, PE checksum,
security-directory entry and a bounded trailing Authenticode certificate table.
Executable headers, sections and pre-certificate overlay bytes must still match the
compiled candidate. The manifest separately binds exact raw hashes of all signed
files; payload comparison does not assert certificate or antivirus acceptance.

Packaging must run `scripts/build/package-smoke.mjs` with a fresh isolated home,
Host and version-one databases. Its `packaged-native-smoke` receipt binds exact
package bytes/build ID and requires all six checks: artifact hashes, embedded
native identity, Host identity, old-database migration, saved-session reading and
actual rendered history. Missing native evidence never becomes a successful
receipt. Only that receipt may be attached to the immutable package manifest.

Preview publishes itself: its `publish` job runs the same publisher against its own
in-progress run, after main CI, packages and smoke passed (owner decision,
2026-11-08). Every other candidate waits for the owner. After the producer workflow
completes successfully, the owner runs **Prepare or publish reviewed candidate** on
`main`, supplying the producer run ID. The
default `publish=false` prepares a draft. The publisher revalidates producer
origin, current source CI attempt, both package manifests, package-smoke receipts
and all six standalone Host archives for stable. It verifies updater signatures
against the trusted configured public key with Ed25519, including the signed
comment. Newer signatures carrying a version must match the candidate version;
historical signatures without a signed version still rely on the immutable
source/package binding. Existing asset names cannot be overwritten with changed
or unverifiable bytes. A tag must resolve to the exact candidate commit.

To publish, the owner explicitly selects `publish=true` and supplies the full
expected SHA, exact version and candidate receipt SHA256. These are rechecked
before changing the draft to public. Only stable emits `latest.json` or becomes
the latest release; nightly/preview remain prereleases, and only preview moves
`updater-feed/preview.json`. The source CI and tag
are checked again immediately before final publication. Artifact retention is
14 days (source stable receipt: 30 days). Package smoke must be less than 24
hours old at review/publication; rebuild a fresh candidate when it expires.

The signature format follows the primary
[minisign verifier](https://github.com/jedisct1/minisign/blob/master/src/minisign.c)
and [Tauri signature envelope](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/helpers/updater_signature.rs).
Local synthetic-key tests verify cryptographic rejection behavior; they do not
establish production signing or hosted release acceptance.

## Unsigned PR previews

Set `BYCODA_UNSIGNED_PR_PREVIEWS=true` and add owner-controlled PR label
`bycoda:preview` to opt in. The PR-scoped producer builds web output only with
read-only repository permissions, no signing/production secrets and a separate
cache namespace. It never builds PR Rust into a trusted native shell. It cannot
write main-scoped caches. The artifact is an unsigned web preview, not a desktop
candidate or installed/live acceptance.

A separate `workflow_run` validator executes only default-branch tooling. It
validates the producer, exact PR head and artifact metadata, rechecks that the PR
is open and still labelled before/after parsing, and never executes downloaded
content. It first parses the outer Actions ZIP as data (exactly one fixed
`preview.zip` member), then validates every inner entry without extracting it.
Traversal, drive/backslash paths, symlinks/special files, encrypted entries,
duplicate/case/Unicode collisions, unsupported types, oversized content and
expansion bombs are rejected. The result stays a short-lived artifact with a
hash/source receipt. No comments, deployments, release assets or feed changes
are made. Fork approval follows the repository's GitHub Actions policy.

## Local frozen-package acceptance

An owner-directed local updater BuildOnly package can be adapted without
installing it:

```powershell
node scripts/release/local-package-manifest.mjs C:/Users/<owner>/.bycoda-build/runs/<id>/manifest.json temp/verification/<id>/package
node scripts/build/package-smoke.mjs --local-frozen --manifest temp/verification/<id>/package/manifest.json --root temp/verification/<id>/package --output temp/verification/<id>/smoke.json
```

The adapter currently supports Windows x64 and requires installed `7z` (override
with `BYCODA_SEVEN_ZIP`). It lists the immutable NSIS archive and reads only
selected bounded members to stdout; it never launches the installer. The native
Tauri-normalized hash and actual embedded Host archive/checksum must match the
updater manifest. The full frozen Host payload is rehashed. Output remains in
the checkout's ignored `temp/` tree. Dirty source fingerprints and original
updater-manifest digest are retained honestly. This is `local-frozen-package`,
accepted only by explicit `{allowLocal:true}`/`--local-frozen`; its smoke evidence
is `local-packaged-native-smoke`. Release validators always reject this kind,
even if its HEAD matches a successful CI source SHA. No local proof substitutes
for trusted CI packaging, signing, publication or installation.

## Opt-in deterministic task-output cache

The only reviewed output contract is `repository-inventory`, a static source
inventory. Test outcomes, browser/native receipts, product builds, services,
provider/model evaluations and mobile/device acceptance are never cached here.
Default CI does not enable it. Owners can explicitly enable the dedicated
`task-output-cache.yml` dispatch, or the main CI manual boolean
`deterministic_task_cache`, on `main`.

```powershell
node scripts/checks/task-cache.mjs key --task repository-inventory
node scripts/checks/task-cache.mjs run --task repository-inventory --store temp/task-cache --output temp/test-results/cached-inventory --allow-local-write
```

Local writing requires `--allow-local-write`. CI writers are trusted main
push/manual runs only; forks are disabled, same-repository PR contexts are
read-only. Identity includes task contract version, OS/architecture, actual Node
and TypeScript compiler bytes/version, locale/time-zone configuration, all
tracked files, actual ignored/generated source inputs, and installed resolver
dependencies/symlink targets. Unknown tasks, dirty trees, external dependency
links, custom Node loaders/options or input bounds that cannot be verified
refuse reuse. Inputs are checked again after execution/restore. This deliberately
conservative implementation may spend more time verifying inputs than it saves;
keep it opt-in until measured useful.

The local adapter and GitHub Actions cache use the same content key. Every hit
rehashes fixed-path output bytes against an immutable trusted-writer manifest;
poisoned or foreign outputs fail. `cache-measurement.json` reports actual hit,
restore duration, verified bytes, input-verification cost and miss execution
duration. Cache hit rate/restore time and total workflow latency are separate
metrics. A cache hit has `liveAcceptance:false`. Hosted hit/restore behavior and
end-to-end duration remain to be measured on committed sources; local fixture
tests do not prove a remote speedup.

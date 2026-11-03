# Release candidates and artifact trust

Release work has separate source, package, smoke, publication and installation
boundaries. A green source workflow or cache hit proves neither a working package
nor an installed application. The maintained controls never publish implicitly.

## Channels and immutable selection

`scripts/release/release-candidate.mjs` accepts a full lowercase 40-character
source SHA. It requires a completed successful `.github/workflows/ci.yml` run
at that SHA, from `push` on `main` or an explicit full `workflow_dispatch`, with
exactly one successful job named `Check`. PR-filtered CI cannot qualify. The
receipt binds repository, run ID/attempt, job ID, URL, channel and version using
SHA256; changed metadata, missing evidence and newer CI attempts are rejected.

| Channel | Version                          | Producer                                             | Update policy                                                      |
| ------- | -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| Stable  | Source numeric `X.Y.Z`           | Owner-created matching `vX.Y.Z` tag                  | Signed updater assets; stable feed only after explicit publication |
| Nightly | `X.Y.Z-nightly.<run-id>.<sha12>` | Manual candidate or opt-in six-hour scheduler        | Unsigned prerelease; no updater endpoints or `latest.json`         |
| Preview | `X.Y.Z-preview.<run-id>.<sha12>` | Manual candidate at reviewed source SHA with full CI | Unsigned prerelease; no stable feed                                |

The release-candidate workflow runs only on trusted `main` tooling. Source SHA
may identify a different reviewed branch with an explicitly dispatched full CI.
An ephemeral CI checkout receives a version-only overlay of root package/Cargo
metadata and Tauri version. It is recorded in the frozen build stamp; source
identity is rechecked after compilation. No developer version files are changed.
The default manual channel is preview. Selecting stable there creates a source
receipt only; signed stable packaging requires its matching owner-created tag.

Scheduled nightly builds are disabled unless repository variable
`BYCODA_NIGHTLY_CANDIDATES=true`. They select the latest successful full main
source and skip unchanged sources or candidates less than six hours apart.
Completed unpublished nightly artifacts count as history, alongside releases.
Manual `force-nightly` bypasses only this time/change gate. Failed or incomplete
source checks never become eligible. A rerun keeps its version; use a new
workflow run for a new immutable candidate.

## Packages and owner publication

The reusable `desktop-package.yml` builds Windows x64 and macOS arm64. Stable
signing keys are present only in the stable tag build step. Nonstable jobs do
not receive those secrets. The stable macOS job also reads the optional Apple
Developer ID and notarization secrets; setup is in
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

Packaging must run `scripts/build/package-smoke.mjs` with a fresh isolated home,
Host and version-one databases. Its `packaged-native-smoke` receipt binds exact
package bytes/build ID and requires all six checks: artifact hashes, embedded
native identity, Host identity, old-database migration, saved-session reading and
actual rendered history. Missing native evidence never becomes a successful
receipt. Only that receipt may be attached to the immutable package manifest.

After the producer workflow completes successfully, the owner runs **Prepare or
publish reviewed candidate** on `main`, supplying the producer run ID. The
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
the latest release; nightly/preview remain prereleases. The source CI and tag
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

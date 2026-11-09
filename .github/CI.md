# Continuous integration

`CI` runs on pull requests, pushes to `main`, and manual dispatches. The final
job is named **Check**. Individual job success, a dependency cache hit, a fixture
screenshot, or a package build is not full CI or installed-app acceptance.
CI has read-only repository access, nonpersisted checkout credentials, and actions
pinned to verified commit SHAs. It does not publish releases, install on developer
machines, or run paid providers.

## Selection and ownership

`scripts/checks/ci-changes.mjs` owns the shared local/CI decision. Git merge-base
and a NUL-delimited diff include deleted paths and both sides of renames. Local
selection also includes untracked, nonignored source. Unknown inputs or unavailable
history select full coverage. A main push diffs against the fetched tip before the
push (a new branch or force push has none and selects full coverage); manual CI
always selects full coverage. Only explicitly irrelevant jobs may skip. New PR commits cancel older PR runs;
distinct main SHAs retain independent runs for exact-source release prerequisites.

| Job                | Scope and evidence                                                                                                                                                                                   | Selection                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Changes            | Source SHA and boolean gates                                                                                                                                                                         | Always                                                        |
| Repository hygiene | Ignored-file policy, issue-label fixtures, format, lint baseline, locale, feature-skill, theme-color, UI-drift, code-structure and UI-catalog checks, and the baseline guard (full-history checkout) | Always                                                        |
| Web                | Shared Host contracts/headless boundaries, Vitest JSON, TypeScript, the test-file type ratchet and Vite bundle                                                                                       | Shared source/native parity, fixtures, common inputs          |
| Host               | Serial files per VM; Linux 1/macOS 2/Windows 6 shards; package once per OS                                                                                                                           | Application/Host and common inputs                            |
| Native (`check`)   | Rust format, Clippy and tests on three OSes                                                                                                                                                          | Native/shared embedded inputs and common inputs               |
| RPM                | Fedora/AlmaLinux build/Requires plus clean AlmaLinux install/loader check                                                                                                                            | Native/package and common inputs                              |
| Scripts            | Maintained Node fixtures recursively under `scripts/` and `.github/scripts/`                                                                                                                         | Shared source read by helpers, harness/tooling/support inputs |
| Python             | Local-update fixtures/logs on Linux and Windows                                                                                                                                                      | Local updater or common inputs                                |
| Browser            | Complete fixture-owner inventory and isolated Chromium smoke                                                                                                                                         | UI/assets/Host-dependent fixtures and common inputs           |
| Check              | All required jobs/variants and exact-source evidence                                                                                                                                                 | Always, including failures/cancellation                       |

Source gates are deliberately conservative: the Host imports application models,
source tests inspect native parity, script fixtures import Host helpers, and Rust
embeds generated contracts. Ordinary UI/Host edits keep web/Host/script/browser
checks selected; only inventoried native embeds additionally select native/RPM.
A repository-graph regression guards that include list. Narrow gates alongside verified dependency
boundaries, with regression cases. Mobile remains an independent nested repository;
its own test/typecheck and native/device acceptance are outside this desktop CI.

The Scripts job also runs `pnpm eval:offline` and requires its JSON report.
These are deterministic model-behavior grader/schema fixtures, with no provider
calls. Context/transport byte measurements and static usage remain advisory;
see [quality tooling](../docs/reference/quality.md).

## Dependency setup

`.github/actions/setup-deps` takes explicit `node-version`, reads exact pnpm from
`package.json#packageManager`, and installs with `--frozen-lockfile --prefer-offline`.
`install: "false"` supplies Node without installing pnpm/JavaScript dependencies.
The pnpm store key includes namespace, OS, architecture, Node, pnpm, manifest/lock/
workspace files, `.npmrc`, `.pnpmfile.cjs`, and patches. Fallback cache restores
reusable downloads; installation still validates the lockfile. Checkouts do not
share whole `node_modules` or mutable build output. Source/test jobs use Node 24;
package jobs retain explicit Node 22. Cargo caches remain separate, with native/RPM
cache writes restricted to main. No remote test-result cache is enabled.

## Local entry points

Heavy trusted Windows jobs can opt in to a dedicated isolated runner with
`BYCODA_WINDOWS_SELF_HOSTED=true`; PRs remain hosted. Provisioning, machine-owned
admission, shared queue semantics, warm cache paths, manual preflight and fallback
are defined in [Windows runners](../docs/reference/windows-runners.md). Source
implementation does not establish that a registered online runner exists.

| Current entry                                                            | Contract                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `node scripts/checks/check-local.mjs`                                    | Plan only; starts no tests, builds or services.                                                   |
| `node scripts/checks/check-local.mjs --run`                              | Changed-file format/lint and changed/adjacent tests; default 12 test files, 120 seconds per step. |
| `node scripts/checks/check-local.mjs --base <ref> --max-tests 8 --run`   | Explicit merge-base and bounded local test selection.                                             |
| `node scripts/checks/check-local.mjs --scripts --run`                    | All maintained Node script fixtures, with no app build/install or paid provider.                  |
| `node scripts/checks/check-host-test-shards.mjs 6`                       | Complete/disjoint Vitest partition discovery; does not execute modules.                           |
| `pnpm test:host --shard=1/6`                                             | One Host shard, including its existing typecheck/build prehook; not full Host acceptance.         |
| `node scripts/checks/browser-test-inventory.mjs --check`                 | Verify every browser spec has one documented owner.                                               |
| `node scripts/checks/browser-tests.mjs --suite smoke --project chromium` | Isolated browser-fixture smoke with explicit evidence.                                            |

The bounded runner uses installed tool binaries and never installs dependencies.
Adjacent Host tests omit the prebuild hook; missing fixture artifacts cause an
honest failure. Deleted files still select CI dependents. Failed Git detection
selects full CI requirements, but bounded local success does not mean those suites
ran. Each local step has a deadline and stops only its owned process tree on timeout.
Optional reports use `--report temp/verification/<id>/local.json`.
See [the testing guide](../docs/reference/testing.md) for legacy command scopes and separate
acceptance lanes. Do not repeat a successful suite/typecheck via another alias
without a relevant change or unresolved failure.

## Evidence and the final Check

Each selected job uploads a bounded JSON manifest in a unique `ci-evidence-*`
artifact: source SHA, GitHub run/attempt, job/variant, result and required report
files. Raw test JSON, Python logs, browser traces/screenshots stay in separate
artifacts. Browser receipts explicitly say `browser-fixture`; source, completion
time and exit code are validated.

`scripts/checks/ci-results.mjs` reads manifests as regular JSON data, never code.
Check rejects failed/cancelled/missing jobs, unexpected skips, missing successful
variants, duplicates, invalid metadata and foreign/stale SHA/run/attempt evidence.
Skip passes only with an explicit false change gate. Docs-only PRs still receive
Changes, Repository hygiene and Check. A download error cannot turn missing required
evidence into success. Branch protection/rulesets must separately require the
intended Check after delivery; YAML alone does not configure repository policy.

## Release performance and retained coverage

The required `preflight` job checks shared schemas/headless boundaries and Rust
formatting before the expensive Host, web, native, RPM and browser matrices start.
Formatting runs once; a failed preflight cannot satisfy the aggregate Check.
Python/script fixtures remain independent so their diagnostics are still available.

Host Linux runs the complete scope. macOS/Windows run
`BYCODA_HOST_TEST_SCOPE=integration`: only unchanged, explicitly reviewed portable
runtime graphs are omitted there. The LF-normalized source hashes in
`scripts/checks/host-portable-tests.json` make any changed/missing graph fall back
to all-OS integration coverage. New tests also default to integration. The shard
checker proves disjoint/full selection, retaining serial isolated files.
`host-test-environment.mjs` uses the installed Vitest sequencer to install Chromium
only for shards containing real Playwright consumers. Runtime caches never cache
test success. The Windows self-hosted heavy lane remains serial by design.

Release packaging consumes a single exact-candidate web/Host JS artifact from
`desktop-package.yml`'s common producer. Desktop jobs still package their own
platform runtime/native output, and stable builds retain all six standalone Host
targets. Candidate/source/byte identity, signing, old-database package smoke and
publication receipts remain required. Phase timings and Rust cache hits appear in
job summaries; source/fixture checks do not establish hosted speed improvements.

## Acceptance boundaries

Browser smoke uses controlled fixtures, not packaged Tauri, live Host/provider,
native permissions or physical devices. Ordinary Cargo tests exclude explicitly
ignored SSH/native acceptance cases. Python updater fixtures do not perform live
updates. Frozen release source/asset validation, native helper environments,
existing-DB migration/rollback, installed app/Host identity, mobile devices and
paid evals retain separate owners and checks. CI grants no publish/install authority.
Local helper tests, workflow linting and partition discovery do not demonstrate
hosted timing, an installed build, or publication; verify those after delivery.

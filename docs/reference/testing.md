# Testing and evidence

Choose the smallest check that exercises the change. Source tests, browser fixtures,
production web boot, packaged launch, installed Host/provider operation and physical
device acceptance are different results. A filename ending in `.e2e.ts` does not
prove that Tauri, an installed service or a paid provider was exercised.

## Commands and scope

| Entry                                                                    | Scope and cost                                                                                                                                           | Exclusions                                                                                                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test -- <file>`                                                    | Root Vitest source tests under `src/` and `packages/`; existing DOM setup and test doubles apply.                                                        | Host suite, Rust, browser, mobile and installed app.                                                                                         |
| `pnpm check:web`                                                         | Existing Host-boundary contracts, root source tests and normal tsc-rs checking. `:fast` explicitly uses fast mode.                                       | Browser/native acceptance. Do not also run the same source suite unchanged through another alias.                                            |
| `pnpm check`                                                             | Web/source checks plus the existing Rust check chain.                                                                                                    | An installer or release is not produced or accepted by this command.                                                                         |
| `pnpm test:host -- <file>`                                               | Existing `pretest:host` runs `host:build` first, then Host Vitest. Tests launch temporary Git/Node/PowerShell processes; files remain serial per runner. | Installed Host/device/provider acceptance. Use the installed Vitest directly only when a current required Host prebuild is already verified. |
| `node scripts/checks/test-inventory.mjs --check`                         | Source-only command/browser ownership and ignored Rust/manual inventory. `--json` includes current script definitions.                                   | Does not execute discovered tests, native helpers or mobile commands.                                                                        |
| `node scripts/checks/browser-tests.mjs --suite smoke --project chromium` | Small shared-control fixture suite. Uses Chromium and an isolated Vite fixture build, loopback server, data and result directory.                        | Native app, production bundle, live Host and provider.                                                                                       |
| `node scripts/checks/browser-tests.mjs`                                  | All default manifest owners, serial fixture suites; all registered browser projects.                                                                     | Explicit alternate-fixture variants; native/mobile/live acceptance.                                                                          |
| `node scripts/checks/browser-built-boot.mjs --plan`                      | Plan for the existing `dist` boot check; creates no build or browser. Without `--plan`, launches existing built assets in isolated Chromium.             | Never invokes a desktop build or native bridge shim. Existing dist source identity is unknown unless independently established.              |
| Commands from `mobile/`                                                  | Mobile owns its package manager/dependencies, source tests and typecheck.                                                                                | Root tests do not certify simulator, physical device, store build or installation.                                                           |

For daily work, `pnpm check:plan` prints the affected-check plan without executing
it; `pnpm check:changed` executes the selected local checks. Full CI uses its
classified jobs and final Check receipt gate. Package acceptance uses the separate
release candidate and platform smoke path. These entries do not turn a skipped
layer into a passing result.

`pnpm test:scripts` runs the repository's Node `.test.mjs`/`.test.cjs` fixtures
through the local selector. `pnpm test:updater` runs Python unittest fixtures in
`scripts/local-update/test_local_update.py`: temporary Git/SQLite/files and mocked
install boundaries, with Windows child-process fixtures where applicable. It does
not perform a live build, installation, SSH operation or stop a personal app or
provider. `scripts/checks/test-remote-ssh.py` is a separate native integration
entry requiring a built Host, Cargo and disposable loopback sshd on macOS/Linux;
it is not part of the source-only updater suite.

Evidence categories follow the boundary exercised: pure logic and DOM component
tests under `src/`, temporary-process Host integration under `host/`, structural
schema/import/RPC checks under `scripts/checks/`, browser fixtures under
`tests/browser/`, existing built-web boot, packaged-native launch, and installed or
live/device acceptance. Structural parity protects a cross-layer contract but does
not prove that a remote operation completed. Keep the category in reports even
when a legacy filename contains `e2e`.

`pnpm build` and `pnpm host:build` retain their normal tsc-rs contracts. Builds are
not routine prerequisites for every source-only check. A release check uses its
frozen source, actual artifacts/hashes and the separately required platform checks.
Model quality evaluations remain a separate, explicitly budgeted provider activity;
deterministic grader/schema checks can run without calling a model.

## Order of verification

Running the whole suite after every edit is the main reason tasks take days. Checks
are evidence for a finished change set, not a progress bar. Order one task like this:

| Phase                  | What runs                                                                                                                                                                 | Not yet                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1. Implement           | Editor feedback, `tsc-rs --noEmit --fast` for the changed project (`-p host/tsconfig.json` for Host), the one test file you are writing with `vitest run <path>`          | Full vitest, `check:web`, browser suites, `cargo test`, screenshots |
| 2. Change set complete | `pnpm check:changed` (format, lint, invariants, structure, UI drift and up to `--max-tests` related tests, all bounded)                                                   | Everything else                                                     |
| 3. Focused tests       | `vitest run src/features/<feature>` or `vitest run --config host/vitest.config.ts host/<feature>`; `cargo test -p <crate> <module>` for Rust                              | Suites of untouched features                                        |
| 4. One full gate       | `pnpm check:web` (or `check:web:fast`), `pnpm host:build` or `pnpm check:rust` when the change touches that layer; run once, in the background, while writing the handoff | A second full run unless a fix changed code                         |
| 5. Evidence            | Screenshots per tier, saved under `temp/verification/<id>/` and opened                                                                                                    |                                                                     |
| 6. Review              | A capable model reads the diff and the phase 2–5 results; fixes go back to phase 1 for the touched files only                                                             |                                                                     |

`check:changed` also runs `cargo fmt --all --check` when a Rust file changed, the
evaluation harness types when application TypeScript changed, and the browser
manifest/type checks when `tests/browser/` changed, because CI runs them for the
whole repository.

Before pushing `main` or a release tag, run `pnpm check:preflight`. It mirrors the
cheap whole-repository CI gates (repository hygiene, formatting, lint/structure/UI
ratchets, Host contracts, Rust formatting, fast types, script fixtures, evaluation
types and graders, browser manifest and types) in about two minutes. Every gate runs
even after a failure, so one run lists everything CI would otherwise reveal one push
at a time. `--only <job>[,<job>]` limits it to the named CI jobs, `--skip-slow` skips
the lint baseline, and `--list` prints the commands. It does not replace the full
vitest, browser, clippy/test or package jobs. A local, uncommitted pre-push hook may
call it for `main` and tag pushes.

Rules that keep the order honest:

- Never start phase 4 to find out what to fix. Phases 1–3 find defects; phase 4
  confirms the finished change set.
- A failure in phase 4 that is unrelated to the change is reported with the output,
  not retried in a loop and not fixed by widening the task.
- Parallel work uses isolated Host/desktop data and allocated ports; two full gates
  on one checkout race each other and prove nothing.
- Delegated subagents on small models may run phases 1–3 for their own files; the
  full gate and the review stay with the responsible session.
- Report fast mode when used, and UNVERIFIED only for a named check with its blocker.

## Browser fixture ownership

`tests/browser/suites.json` owns default file selection, named browser projects,
fixture configuration and explicit variants. Existing dedicated Playwright/Vite
configs remain compatible entry points and retain their feature-specific setup.
`runner.playwright.config.ts` supplies common execution/evidence policy; it imports
the owning config rather than combining all product features into one fixture.

```sh
node scripts/checks/browser-tests.mjs --plan
node scripts/checks/browser-tests.mjs --suite settings --list
node scripts/checks/browser-tests.mjs --suite composer --project webkit
node scripts/checks/browser-tests.mjs --suite tasks-rewind --project chromium
node scripts/checks/browser-tests.mjs --suite smoke --project chromium -- --grep "keyboard button hints"
node scripts/checks/browser-tests.mjs --include-variants --project chromium --shard 1/6
node scripts/checks/browser-tests.mjs --include-variants --project webkit --shard 1/4
node scripts/checks/browser-test-inventory.mjs --check
```

`--plan` reads only the manifest. `--list` performs actual Playwright test discovery
but starts no fixture server or browser. `all` selects each default owner once;
`smoke` is an alias for `arc-controls`. Use a comma-separated or repeated `--suite`
to choose several owners. Explicit variants preserve rewind checks against the
chat-artifact, tasks and merge-editor fixtures. The composer browser projects
preserve the former sessions-composer browser coverage without a duplicate default
Chromium run. Root `playwright test` is the shared transcript entry; use the
manifest runner for the complete collection.

Legacy configs may intentionally select the same file in another fixture. Running
every legacy config manually is not the canonical full suite. New files need one
default owner in the manifest; browser/theme/viewport repetitions inside the spec
remain deliberate coverage. Tests are not deleted to make an inventory pass.

Before changing selection, capture the existing actual discovery and compare it:

```sh
node scripts/checks/browser-test-inventory.mjs --capture-legacy temp/verification/<id>/before.json
node scripts/checks/browser-test-inventory.mjs --verify-list --baseline temp/verification/<id>/before.json --output temp/verification/<id>/after.json
```

Capture the baseline before editing the root/legacy selection. The comparison uses
file, line, nested test title and browser project; it catches a `grep` losing tests
even when a file remains selected. Default identities must not repeat. Explicit
fixture variants are separately named and retained. Concurrent edits can change
discovery; inspect that delta rather than silently refreshing the baseline.

## Required smoke and full CI collection

Pull requests require the classified Chromium smoke. Main pushes and manual CI
runs execute the full collection instead: six Chromium and four WebKit partitions,
with at most six full-browser VMs running together. Both named projects retain
their existing per-feature setup. Each suite/project pair belongs to one
partition; full CI deliberately includes all three alternate-fixture variants.
The 2026-11-01 discovery snapshot has 2009 default browser cases and 2115
suite/browser cases when the 106 deliberate alternate-fixture cases are included.
This is a coverage count, not a promise about duration.

The Settings collection has six default groups sharing its existing fixture:
`settings`, `settings-navigation`, `settings-workspace`, `settings-library`,
`settings-subviews`, and `settings-backgrounds`. `--suite settings` remains an
alias selecting the complete collection. Forwarded file/grep filters skip groups
with no matching cases without launching a server; if nothing matches, the runner
fails. This filtered local result cannot satisfy full CI evidence.

`tests/browser/ci-weights.json` holds advisory expanded discovery counts. Greedy
scheduling prefers measured `durationMs` when supplied, otherwise case counts
times `fallbackMsPerCase` (1000 by default). Stale weights can affect
balance but cannot remove a suite or test. Every run still performs actual
list-only discovery before execution. Its receipt binds the manifest/selection,
named project, partition, explicit variants, forwarded filters and the hashed
discovery/execution reports. The final Check requires every selected partition,
its clean exact source SHA and current workflow run/attempt. It rejects missing
reports, missing cases, duplicate partitions, all-skipped suites, hidden retries
and a narrowed `--grep` receipt presented as the full suite.

Import complete successful timing receipts without rerunning a browser:

```sh
node scripts/checks/browser-ci-timings.mjs --receipt temp/test-results/browser/run.json --output temp/verification/<id>/advisory-weights.json
```

Repeated `--receipt` inputs use medians, preserving the supplied case inventory.
The importer verifies discovery/report hashes and full nonflaky results, rejects
filtered/mixed-project/truncated receipts, and labels dirty local samples as
advisory. Review the output before deliberately updating the maintained weights;
it is scheduling data, never test-success or release authority.

```sh
node scripts/checks/browser-test-inventory.mjs --verify-list --partitions --baseline temp/verification/<id>/before.json --output temp/verification/<id>/after.json
```

Main/manual policy and PR smoke are distinct. A skipped full matrix on a PR is
explicitly permitted; the same skip cannot satisfy a main/manual result. Browser
runtime caches key the pinned Playwright version, OS, architecture and project;
they cache downloaded runtimes, not test success. The separate manual CI
`deterministic_task_cache` option defaults off and caches only the reviewed static
repository inventory on trusted main, with complete inputs and restored-byte
rehashing. It never skips browser, source, native or release acceptance.

## Isolation and reports

Each runner invocation creates a unique child directory under
`temp/test-results/browser/`, or `BYCODA_BROWSER_ARTIFACT_DIR`. It includes source
HEAD plus dirty-state truth, selected suites, durations, exit codes and result paths.
The base directory's `run.json` is the current receipt; consumers must validate its
freshness/source/exit status, not accept an old file as success. Each suite has a
Playwright JSON report, failure trace and failure screenshot. CI should upload both
the receipt and the referenced run directory.

The common server uses each existing Vite config, an isolated build/cache directory
and a fresh loopback port. Absolute-origin assertions in browser-annotation and
edit-from-here retain their reserved ports; occupied endpoints fail, never attach
to another session. Fixture suites run sequentially. Legacy direct invocations keep
their existing fixed-port and output contracts and should not be run concurrently
against the same fixture. The runner never reuses an existing server.

Fixtures must use synthetic data/grants and temporary repositories, not production
projects or credential stores. No test may stop an unrelated Host/agent process to
obtain a port. Preserve drafts, validation, permissions and teardown. Await the
event/receipt that proves completion; avoid sleeps, retries and raised timeouts that
hide races. Shared infrastructure regressions deserve meaningful harness tests;
labels, constants and pure visual spacing do not each need new mirror assertions.

## Built web, native and manual acceptance

The built-web entry serves existing files with a loopback static server and blocks
non-artifact network requests. Existing dist always has unknown source inclusion.
`--build` explicitly creates a new production output through Vite, captures source
identity before/after, and fails if that source changes during the build. Its
receipt records the captured source fingerprint, dirty-state truth and built-file
digest; normal tsc-rs is a separate CI prerequisite.

```sh
node scripts/checks/browser-built-boot.mjs --build --dist temp/build/<id>/dist --boundary native-unavailable --output temp/verification/<id>/web --receipt temp/verification/<id>/web.json
```

The desktop production entry requires Tauri for workspace operation. Its plain
browser path renders the existing native-unavailable recovery surface. The
`native-unavailable` boot boundary requires that actual shipped surface, exercises
its localized reload action, checks for runtime errors, and captures light/dark
at 1280/800. It injects no Tauri bridge and does not claim that a saved workspace,
Host or provider worked. The separate `workspace` boundary remains available for
a genuinely web-capable entry via `--ready-selector`. CI requires fresh captured
clean-source production boot evidence; a successful old-dist observation cannot
satisfy it.

For a coordinator-owned frozen output, pass `--expected-build-identity
<frozen>/build/build-info.json` together with `--dist <frozen>/dist`. The complete
embedded web stamp must match that explicitly selected producer identity. The
receipt binds its source fingerprint, build ID, dirty-state truth and observed
web-file digest. A dirty frozen snapshot does not establish complete HEAD feature
inclusion and cannot satisfy the CI requirement for clean-source evidence.

## Packaged native smoke

For an isolated development run while another owner edits the checkout,
`pnpm exec node scripts/build/dev-native.mjs --frozen-source <absolute-root> --bootstrap
--workspace-id <id> --run-id <unique-id> --shared-target <dedicated-cache-root>`
uses a frozen source directory with its own dependency links, Host build,
Vite server, profiles and copied executable. The cache root must belong to this
verification lane; do not reuse an active owner's Cargo target. The launcher
leases the derived target before compiling and copies the executable before
releasing it. `--cargo-target <absolute-target>` is an optional explicit override;
all users of that target must still share the same cache lease root.

The frozen root requires `frozen-source.json`: schema version 1, an original
`BuildIdentityManifest` in `identity` (channel `dev`), and `files` entries with
relative `path` and SHA-256 `sha256`. Create the directory from
`sourceFiles()` and use `captureBuildIdentity()` to verify the copied bytes
against a stable original source before writing the inventory. No synthetic Git
metadata is needed. The launcher verifies every inventory entry and the aggregate
source fingerprint before starting children and again after compilation; changed
or missing inputs fail the run. Its run record names the frozen root and manifest.
Capture metadata must compare against that frozen identity, and report any later
checkout changes separately. Native CDP evidence still requires the running
`build_identity` to match the run manifest. This mode performs no installation
and provides no release or user-acceptance evidence.

```sh
node scripts/build/package-smoke.mjs --manifest <stage>/manifest.json --root <stage> --output temp/verification/<id>/package-smoke.json
```

This command consumes an explicit immutable desktop-package manifest. It validates
the trusted candidate/source stamp and every component/payload hash, copies those
verified bytes to a new owned run directory, and revalidates the copy. It never
builds, installs, resumes an updater, controls a service or launches an installed
app. Each supported target must run its actual packaged executable and packaged
Host runtime on that target OS.

Before any process launch it also requires the native executable's guarded-smoke
protocol markers. An older otherwise hash-valid executable may ignore the flag;
it is rejected for rebuilding rather than allowed to open an ordinary profile.
Markers establish compatibility of the hash-verified artifact, not native runtime
acceptance; the real guarded proof is still mandatory.

For an owner-authorized local BuildOnly package, the separate
`scripts/release/local-package-manifest.mjs <updater-manifest.json> <new-temp-stage>`
adapter verifies its frozen hashes and extracts the installer without executing
it. The smoke harness accepts this distinct manifest only with `--local-frozen`
and emits `local-packaged-native-smoke`, including the frozen package digest.
It does not invent a trusted CI candidate receipt; publication rejects local
manifests and local smoke evidence.

The explicit `--package-smoke` native mode requires a nonce-bound owned request,
fresh home/profile, exact embedded build identity and old-database seed hash.
Tauri's own directory override isolates native config/data/cache/logs; WebView
data and Host data also remain below the owned temporary root. Invalid explicit
mode fails before ordinary stores start. Normal launches retain their existing
behavior. The smoke branch skips orphan reaping and bundled Host installation;
the harness starts only its copied Host as a supervised foreground child.

Windows runs use a fresh nonce directory under the actual user-local
`LOCALAPPDATA/bycoda/package-smoke-runs/`, following the existing native-run ACL
boundary. A shared checkout volume may not grant the Host's required ACL rights;
the harness never disables that protection. The receipt and bounded proof/log
copies remain in the checkout's ignored evidence directory, including the
`<receipt>.evidence/` companion folder for CI upload.

The seed is a synthetic version-one native SQLite schema with an idle saved
conversation and workspace snapshot, plus an old Host SQLite schema containing
the same retained history. The actual production stores perform migration. The
Host must report the packaged build identity through its authenticated local
lifecycle endpoint. A page-load hook observes the real native WebView; normal
`session_get` must read the saved session and its title/history must be rendered.
The native callback also reads the migrated database and emits an immutable
nonce/process/build/artifact-bound proof. A fixture-generated proof or a schema
unit test is not native acceptance.

The receipt requires artifact hashes, embedded native identity, Host identity,
old DB migration, saved-session read and rendered history. Failure or missing
proof cannot be promoted to success. It stops only processes spawned by that run
and retains receipts/logs/data for review. Windows and macOS publication each
require their own real successful receipt; source/guard tests cannot stand in for
an unavailable platform package or WebView.

`test-inventory.mjs` enumerates Rust `#[ignore]` names, locations, reasons and
categories. Some are child-process helpers invoked by a parent crash test; others
need disposable sshd/SFTP, Git Bash/PS7/ConPTY, proxy/TLS CA/OpenSSL or a built
headless helper. Performance tests need explicit resource budgets. Personal-store
and Termius checks need separate owner authorization. The inventory is not a
blanket `cargo test -- --ignored` instruction and assigns no acceptance owner.

Report a named unrun native/live/device check and its concrete missing fixture,
binary, platform or authorization. Root source/fixture success must never be
reported as installed Windows/macOS, physical phone, NVDA/VoiceOver or paid-provider
success. Preserve useful existing captures; new evidence belongs under
`temp/verification/<id>/` with a short purpose/source/reuse README.

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
The 2026-10-27 discovery snapshot has 1498 default identities and 1604
suite/browser cases when the 106 deliberate alternate-fixture cases are included.
This is a coverage count, not a promise about duration.

`tests/browser/ci-weights.json` holds advisory measured discovery counts. Greedy
scheduling uses these weights and stable suite IDs; stale weights can affect
balance but cannot remove a suite or test. Every run still performs actual
list-only discovery before execution. Its receipt binds the manifest/selection,
named project, partition, explicit variants, forwarded filters and the hashed
discovery/execution reports. The final Check requires every selected partition,
its clean exact source SHA and current workflow run/attempt. It rejects missing
reports, missing cases, duplicate partitions, all-skipped suites, hidden retries
and a narrowed `--grep` receipt presented as the full suite.

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

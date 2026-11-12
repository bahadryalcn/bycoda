# Code invariants

Rules that an audit of the desktop app, the Host and the native layer showed to be the root of
recurring defects: window events acting in every window, state files that come back empty after
a power loss, provider output that stops at the first non-UTF-8 byte, half an emoji in a tray
title, run limits that count the time a laptop spent asleep. Each rule names the sanctioned
helper, the check that enforces it and how to suppress one line with a reason. The rules apply
to every contributor and to every agent writing code in this repository.

Enforcement is a ratchet: existing findings are counted per file and rule in
`scripts/checks/invariants-baseline.json` and `scripts/checks/ui-drift-baseline.json`. New
findings fail the check; the baselines may only fall. `pnpm check:baselines` compares
per-rule totals with the base branch and rejects a rise that
`scripts/checks/baseline-approvals.json` does not record. `pnpm check:invariants --report`
and `pnpm check:ui-drift --report` list the current debt per rule and folder.

[rules.md](rules.md) is the complete, generated list of every enforced rule with its engine,
scope and suppression syntax; `pnpm check:rules` runs all of them. This page explains why the
K rules exist, which helper to use, and which invariants have no static check yet.

## Commands

| Command                                                                    | What it runs                                                                                                                                               |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:invariants`                                                    | Every oxlint rule the `lint` block of `vite.config.ts` sets to `"error"` (the repository plugin and the API bans), plus the Rust ast-grep rules, ratcheted |
| `pnpm check:invariants -- --files a.ts b.rs`                               | Only the given files (what `check-local` does for changed files)                                                                                           |
| `pnpm check:invariants -- --report`                                        | Totals per rule and folder, no gate                                                                                                                        |
| `pnpm check:invariants -- --ratchet`                                       | Lower baseline buckets after a cleanup (never raises)                                                                                                      |
| `pnpm check:ui-drift`                                                      | UI component-usage rules (regex over `src/app`, `src/features`, shared stylesheets)                                                                        |
| `pnpm exec vp lint --quiet <path>`                                         | Raw TypeScript findings with the rule message, no baseline                                                                                                 |
| `pnpm exec ast-grep scan -c scripts/checks/invariants/sgconfig.yml <path>` | Raw Rust findings with the rule message, no baseline                                                                                                       |

Suppress one line only, with the reason on the same comment (a suppression comment
without ` -- <reason>` is itself a finding, `bycoda/suppression-has-reason`), and name the
condition for
removing the suppression in the reason when it is temporary:

```ts
// oxlint-disable-next-line bycoda/handled-background-promise -- flush() reports its own failures
void this.flush();
// oxlint-disable-next-line no-restricted-properties -- persisted timestamp, not a duration
const createdAt = Date.now();
```

A baseline count that goes up is a review finding, not an accepted exception.

## Platform invariants

`bycoda/shared-formatters-only` has no baseline allowance: feature and app code import
formatters; their
implementations live in `src/shared/i18n`. Existing output variants retain their
rounding, units, invalid-input handling and locale selection during migration.

| Invariant                   | Rule                                                                                                                                                                                                                                                                         | Use instead                                                                                                                                                     | Enforced by                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared formatters           | No `format(Bytes\|FileSize\|Relative\|RelativeTime\|Duration\|Elapsed\|Date\|Compact)*` function definitions in `src/features` or `src/app`. Constructing `Intl` formatters is `bycoda/app-locale-formatting`.                                                               | `src/shared/i18n`, including `formatElapsed` and `formatCompactCount`; direct imports and re-exports retain consumer APIs.                                      | plugin `bycoda/shared-formatters-only`; zero findings, no baseline additions                                                                 | `bycoda/shared-formatters-only`                                                                   |
| Window-scoped events        | A webview listens for native events on its own window only. A plain `listen()` is an `Any` target and receives events Rust sent with `emit_to(label)`; with two windows open, one menu click runs twice. Rust emits window-targeted events with `emit_to`, never `app.emit`. | `listenWindow` / `onceWindow` / `listenWindowAsync` in `src/platform/tauri/listenWindow.ts`; `emit_to` / `emit_to_focused` in Rust                              | oxlint `no-restricted-imports` (`@tauri-apps/api/event`); ast-grep `rust-emit-broadcast`                                                     | `rust-emit-broadcast`, `no-restricted-imports` (`@tauri-apps/api/event`)                          |
| Atomic state files          | A file the process reads back at startup is written through a temp file that is fsynced before the rename, and corrupt state is retained as evidence. Missing, corrupt and unreadable are distinct; authority-bearing state fails closed until repaired.                     | `writeFileAtomic` / `writeFileAtomicSync` / `readStateFile` in `host/storage/atomic-write.ts`; in Rust `sync_all()` before `rename`                             | oxlint `no-restricted-imports` (`writeFileSync`/`writeFile` in `host/`); ast-grep `rust-rename-without-fsync`                                | `rust-rename-without-fsync`, `no-restricted-imports` (`node:fs` writers)                          |
| Lossy decoding              | Bytes from a child process or socket are decoded lossily per line; one invalid byte never ends the reader. Windows code-page output and chunks split inside a multibyte character are normal input.                                                                          | `read_until(b'\n')` + `String::from_utf8_lossy`                                                                                                                 | ast-grep `rust-bufreader-lines-on-stream`                                                                                                    | `rust-bufreader-lines-on-stream`                                                                  |
| Handled background promises | In the Host and `packages/`, a promise that nobody awaits has a rejection handler. The Host logs an unhandled rejection and marks the service degraded; `.finally()` alone is not a handler. The webview only logs rejections, so the rule does not apply under `src/`.      | `.catch(report)`, `.then(ok, fail)`, or `await` in try/catch                                                                                                    | plugin `bycoda/handled-background-promise` (`host/**`, `packages/**`)                                                                        | `bycoda/handled-background-promise`                                                               |
| Command deadlines           | A child process or external command has a deadline; a stuck credential helper must not hold a worker thread or a busy flag for good.                                                                                                                                         | `crate::fs::output_with_timeout`; timed `try_wait` loops; `AbortSignal.timeout` in TypeScript                                                                   | ast-grep `rust-command-output-without-timeout` (Rust only; TypeScript callers are covered by review)                                         | `rust-command-output-without-timeout`                                                             |
| Blocking accepted sockets   | A socket accepted from a non-blocking listener is switched back to blocking (with read/write timeouts) before a blocking handler uses it; macOS and Windows inherit the listener's mode.                                                                                     | `socket.set_nonblocking(false)` in the `Ok` arm                                                                                                                 | ast-grep `rust-accept-inherits-nonblocking`                                                                                                  | `rust-accept-inherits-nonblocking`                                                                |
| Grapheme-safe truncation    | User-visible or IPC-bound text is truncated on grapheme boundaries. `slice(0, n)` can leave an unpaired surrogate that native JSON parsing rejects.                                                                                                                          | `truncateGraphemes` / `truncateCodeUnits` in `src/shared/lib/text/truncate.ts`                                                                                  | plugin `bycoda/grapheme-safe-truncate`                                                                                                       | `bycoda/grapheme-safe-truncate`                                                                   |
| Safe timestamp rendering    | Rendering a stored timestamp never throws. `new Date(x).toISOString()` raises on invalid input and unmounts the whole React tree.                                                                                                                                            | `isoTimestamp` / `parseTimestamp` in `src/shared/lib/time/timestamps.ts`                                                                                        | plugin `bycoda/safe-timestamp-render`                                                                                                        | `bycoda/safe-timestamp-render`                                                                    |
| Monotonic durations         | Durations and run limits are measured on a monotonic clock; wall-clock time jumps across sleep and clock changes. Schedulers detect a gap and skip missed occurrences instead of firing them all.                                                                            | `monotonicNow` / `elapsedSince` / `wallClockGap` in `src/shared/lib/time/timestamps.ts`                                                                         | oxlint `no-restricted-properties` (`Date.now` in the listed scheduler modules and in Host files named `*schedul*`, `*budget*`, `*watchdog*`) | `no-restricted-properties` (`Date.now`)                                                           |
| App-locale formatting       | Dates, times, numbers, byte sizes and durations are formatted by the shared helpers so every surface follows the app language and the same rounding.                                                                                                                         | `formatDate` / `formatNumber` (`src/shared/i18n/core.ts`), `formatRelativeTime` / `formatBytes` / `formatDuration` (`src/shared/i18n/format.ts`), `<Timestamp>` | plugin `bycoda/app-locale-formatting`                                                                                                        | `bycoda/app-locale-formatting`                                                                    |
| UTF-8 child locale          | Child processes that match text run with `LC_ALL=C.UTF-8`, never `LC_ALL=C`, so case-insensitive matching of non-ASCII letters works and binary detection is byte-accurate.                                                                                                  | `LC_ALL: "C.UTF-8"`                                                                                                                                             | plugin `bycoda/utf8-child-locale`                                                                                                            | `bycoda/utf8-child-locale`                                                                        |
| Whole-sentence translation  | Translated text is never concatenated with literals; variable parts go through placeholders.                                                                                                                                                                                 | `t("Saved {p0} files", { p0: count })`                                                                                                                          | plugin `bycoda/whole-sentence-translation`                                                                                                   | `bycoda/whole-sentence-translation`                                                               |
| External links              | External URLs open through one validated helper; no `target="_blank"`, `window.open` or direct opener imports in feature code.                                                                                                                                               | `openExternal` / `isExternalUrl` in `src/platform/tauri/openExternal.ts`                                                                                        | oxlint `no-restricted-imports` / `no-restricted-properties`; UI drift `target-blank`                                                         | `no-restricted-imports` (`@tauri-apps/plugin-opener`), `no-restricted-properties` (`window.open`) |
| Explained suppressions      | A lint, UI drift, ast-grep or TypeScript suppression carries its reason in the same comment.                                                                                                                                                                                 | `// oxlint-disable-next-line <rule> -- <reason>`                                                                                                                | plugin `bycoda/suppression-has-reason`                                                                                                       | `bycoda/suppression-has-reason`                                                                   |
| Bounded ledgers             | A receipt or registry map with a fixed capacity evicts settled entries by age; a cap that only grows turns into "works until restart". Idempotency windows must outlive any client retry window, not the process.                                                            | A TTL on settled entries (see the audit items P0-08, P0-10, P0-11, P0-14)                                                                                       | Review + regression test (no static rule yet)                                                                                                | none, review and regression tests                                                                 |
| Multi-window state          | App-wide state (layout snapshot, in-flight sessions, automation recovery, lead election) is keyed by window or claimed once per process; a second window never overwrites or "recovers" another window's work.                                                               | Window-keyed rows, process-level recovery flag, Web Lock election (`syncWindowOwner.ts`)                                                                        | Review + regression test (no static rule yet)                                                                                                | none, review and regression tests                                                                 |

## React performance invariants

Rules that keep the webview from doing avoidable render work. They mirror the checks the T3 Code
web app enforces in its own lint plugin; here they are rules of the repository oxlint plugin, so
existing code is counted in the baseline and only new findings fail.

| Invariant                  | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Use instead                                                                                                                                                                                              | Enforced by                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Compiler-owned memoization | Where the React Compiler compiles in full (`src/shared/ui`, `src/features/sessions/ui`, `src/features/sync`, `src/features/terminal`, `src/features/projects`, `src/features/notifications`, `src/app/shell`; `INFERRED` in `scripts/build/react-compiler.ts`), no `useMemo`, `useCallback`, `memo()` or `"use memo"`: the compiler memoizes. Elsewhere `"use memo"` remains the opt-in. A hand-written `"use no memo"` is rejected in all of `src/`.                                                 | Plain values and functions in render; fix what the `[react-compiler]` build warning names. A function the compiler skips keeps its hook with a reasoned suppression.                                     | plugin `bycoda/compiler-owns-memo`, `bycoda/compiler-stays-on` | `bycoda/compiler-owns-memo`, `bycoda/compiler-stays-on` |
| Compiler coverage          | In the folders the React Compiler compiles in full, a component or hook it skips (the guard opts it out for a render-time read of the module `t()`, storage or the clock; the compiler bails out on a ref read in render, a mutation after render, `try`/`finally`) re-runs in full on every render. `pnpm check:compiler` counts skipped functions per file against `compiler-coverage-baseline.json`; `--report` lists reasons. The memoization ban applies only to files with no skipped function. | `scripts/checks/check-compiler-coverage.mjs`                                                                                                                                                             | `scripts/checks/check-compiler-coverage.mjs`                   | `scripts/checks/check-compiler-coverage.mjs`            |
| Named effects              | Every `useEffect`, `useLayoutEffect` and `useInsertionEffect` in `src/` states what it keeps in step. Effects that only move state around cause an extra render per change and are the usual source of render loops.                                                                                                                                                                                                                                                                                  | Derive in render, act in the event handler, key the component, `useSyncExternalStore` or a store hook. A real synchronisation with something outside React keeps its effect and says so.                 | plugin `bycoda/effect-names-its-sync`                          | `bycoda/effect-names-its-sync`                          |
| Shared resize observer     | No `new ResizeObserver` in `src/`. One observer per component means one callback per component on every layout.                                                                                                                                                                                                                                                                                                                                                                                       | `observeResize(element, listener)` in `src/shared/lib/observeResize.ts`: one shared observer per window, returns the unsubscribe function.                                                               | plugin `bycoda/shared-resize-observer`                         | `bycoda/shared-resize-observer`                         |
| Live-resize work           | During a live resize (a `Sash` drag or the window being resized) pane sizes change every frame. Work that is expensive per size change (PTY resize, clearing measured sizes, un-containing off-screen content, canvas redraw, layout bookkeeping) runs once when the resize ends, not per frame. Nothing toggles a class or an inherited style on `<html>`/`<body>` for a drag: that restyles the whole document.                                                                                     | `deferDuringResize(run)` / `resizeGestureActive()` / `onResizeGestureEnd()` in `src/shared/lib/resizeGesture.ts`; the shared `Sash` reports the gesture and shows the drag cursor on one shield element. | Review + regression test (no static rule yet)                  | none, review and regression tests                       |

A kept effect names its reason on the line above:

```ts
// oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the window resize listener attached while mounted
useEffect(() => observeResize(node, measure), [node, measure]);
```

## UI invariants

Component-usage and token conventions (native controls, anchors, dialogs, live regions,
spinners, tooltips, weights, colours, spacing, focus, copy, motion, accessibility) are defined
once, in `scripts/checks/check-ui-drift.mjs` and the `lint` block of `vite.config.ts`. Each definition names the
shared component or token to use instead, and all of them are listed in [rules.md](rules.md). The reasoning behind them is in
`docs/reference/ui-design-system.md` and the component catalog in
`docs/reference/ui-components.md`.

## Adding or changing a rule

1. Start from a reproducible failure and write the sanctioned helper first, with a focused test.
2. Add the rule in the place that owns its language: a TypeScript rule as one file in
   `scripts/checks/oxlint-plugin/rules/` (message, file scope and AST visitors together;
   register it in `index.mjs` and set it to `"error"` in `scripts/checks/lint-config.mjs`), a plain API ban
   as an `"error"` rule in the same `lint` block, a Rust rule as
   `scripts/checks/invariants/rules/rust-<name>.yml` (ast-grep), a CSS or component-usage
   convention in `check-ui-drift.mjs` with a unit test in `check-ui-drift.test.mjs`. Messages
   are English and name the alternative.
3. Calibrate on the tree: `pnpm check:invariants -- --report`. Fix false positives before
   baselining; a rule with more noise than signal is removed, not baselined.
4. Record the current debt: `node scripts/checks/check-invariants.mjs --update-baseline` (or
   `check-ui-drift.mjs --update-baseline`) and review the diff.
5. Define the rule once. Before adding it, search [rules.md](rules.md) for a rule that
   already covers the case and widen that one instead. A rule is known by its name alone, so
   name it after what it requires (`shared-resize-observer`, not `no-resize-observer-2`), then
   regenerate the list with `node scripts/checks/rule-index.mjs --write`. Add the rationale and helper to
   the table above when the rule is new; rule text itself is never copied into another doc.

Rust static rules run without compiling (ast-grep parses the source), so they also run on hosts
without the GTK/WebKit development packages. When a Rust rule's baseline reaches zero, promote it
to `clippy.toml` `disallowed-methods` so the compiler enforces it with type information.

## Not covered by a static rule

These need a regression test with every fix; the cases are:

- Lifetime-capped maps without TTL eviction (bounded ledgers).
- Multi-window writers of a single app-wide row (multi-window state).
- Schedulers that replay every missed occurrence after sleep.
- Per-turn inactivity watchdogs for provider processes.
- Size-driven work that runs on every frame of a live resize (live-resize work).

## Component family ownership

`check:ui-drift` and `check:ui-catalog` share the UI drift ratchet for component metadata and orphan
exports. Shared wrappers are the door to Arc primitives and native-popup internals (`ui-wrapper-import`).
`portal-outside-shared` also guards shared floating surfaces outside `Popover` and the explicit OS-window
owners. Feature code uses shared overlay components instead of raw popup roles.

Every exported shared component declares `@group` and `@use` (`component-metadata`); siblings in a group
name one another in `@avoid` or `@replaces` (`component-family-choice`). No product importer means remove
the export (`component-orphan`); an entry in `orphanAllowlist` needs a reason. Tests and specimens are not
product importers. Native-control, loading, surface and interaction rules also cover progress bars,
badges/chips, tab/segmented recipes and native `title` tooltips. Their messages name the shared owner.
Existing debt is recorded per file/rule; only a new or widened rule justifies a baseline approval.

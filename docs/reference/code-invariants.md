# Code invariants

Rules that an audit of the desktop app, the Host and the native layer showed to be the root of
recurring defects: window events acting in every window, state files that come back empty after
a power loss, provider output that stops at the first non-UTF-8 byte, half an emoji in a tray
title, run limits that count the time a laptop spent asleep. Each rule names the sanctioned
helper, the check that enforces it and how to suppress one line with a reason. The rules apply
to every contributor and to every agent writing code in this repository.

Enforcement is a ratchet: existing findings are counted per file and rule in
`scripts/checks/invariants-baseline.json` and `scripts/checks/ui-drift-baseline.json`. New
findings fail the check; the baselines may only fall. `pnpm check:invariants --report` and
`pnpm check:ui-drift --report` list the current debt per rule and folder.

## Commands

| Command                                                                    | What it runs                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm check:invariants`                                                    | ast-grep rules in `scripts/checks/invariants/rules/` plus `.oxlint-invariants.json`, ratcheted |
| `pnpm check:invariants -- --files a.ts b.rs`                               | Only the given files (what `check-local` does for changed files)                               |
| `pnpm check:invariants -- --report`                                        | Totals per rule and folder, no gate                                                            |
| `pnpm check:invariants -- --ratchet`                                       | Lower baseline buckets after a cleanup (never raises)                                          |
| `pnpm check:ui-drift`                                                      | UI component-usage rules (regex over `src/app`, `src/features`, shared stylesheets)            |
| `pnpm exec ast-grep scan -c scripts/checks/invariants/sgconfig.yml <path>` | Raw findings with the rule message, no baseline                                                |

Suppress one line only, with the reason on the same comment, and name the condition for
removing the suppression in the reason when it is temporary:

```ts
// ast-grep-ignore: ts-void-promise-without-catch -- flush() reports its own failures
void this.flush();
// oxlint-disable-next-line no-restricted-properties -- persisted timestamp, not a duration
const createdAt = Date.now();
```

A baseline count that goes up is a review finding, not an accepted exception.

## Platform invariants

| ID              | Rule                                                                                                                                                                                                                                                                         | Use instead                                                                                                                                                     | Enforced by                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| K-WINDOW-EVENT  | A webview listens for native events on its own window only. A plain `listen()` is an `Any` target and receives events Rust sent with `emit_to(label)`; with two windows open, one menu click runs twice. Rust emits window-targeted events with `emit_to`, never `app.emit`. | `listenWindow` / `onceWindow` / `listenWindowAsync` in `src/platform/tauri/listenWindow.ts`; `emit_to` / `emit_to_focused` in Rust                              | oxlint `no-restricted-imports` (`@tauri-apps/api/event`); ast-grep `rust-emit-broadcast`                      |
| K-ATOMIC        | A file the process reads back at startup is written through a temp file that is fsynced before the rename, and corrupt state is retained as evidence. Missing, corrupt and unreadable are distinct; authority-bearing state fails closed until repaired.                                                                                   | `writeFileAtomic` / `writeFileAtomicSync` / `readStateFile` in `host/storage/atomic-write.ts`; in Rust `sync_all()` before `rename`                             | oxlint `no-restricted-imports` (`writeFileSync`/`writeFile` in `host/`); ast-grep `rust-rename-without-fsync` |
| K-UTF8          | Bytes from a child process or socket are decoded lossily per line; one invalid byte never ends the reader. Windows code-page output and chunks split inside a multibyte character are normal input.                                                                          | `read_until(b'\n')` + `String::from_utf8_lossy`                                                                                                                 | ast-grep `rust-bufreader-lines-on-stream`                                                                     |
| K-ASYNC         | A promise that nobody awaits has a rejection handler. In the Host an unhandled rejection terminates the service.                                                                                                                                                             | `.catch(report)`, `.then(ok, fail)`, or `await` in try/catch                                                                                                    | ast-grep `ts-void-promise-without-catch`                                                                      |
| K-TIMEOUT       | A child process or external command has a deadline; a stuck credential helper must not hold a worker thread or a busy flag for good.                                                                                                                                         | `crate::fs::output_with_timeout`; timed `try_wait` loops; `AbortSignal.timeout` in TypeScript                                                                   | ast-grep `rust-command-output-without-timeout`                                                                |
| K-SOCKET        | A socket accepted from a non-blocking listener is switched back to blocking (with read/write timeouts) before a blocking handler uses it; macOS and Windows inherit the listener's mode.                                                                                     | `socket.set_nonblocking(false)` in the `Ok` arm                                                                                                                 | ast-grep `rust-accept-inherits-nonblocking`                                                                   |
| K-TEXT          | User-visible or IPC-bound text is truncated on grapheme boundaries. `slice(0, n)` can leave an unpaired surrogate that native JSON parsing rejects.                                                                                                                          | `truncateGraphemes` / `truncateCodeUnits` in `src/shared/lib/text/truncate.ts`                                                                                  | ast-grep `ts-text-truncate-utf16`                                                                             |
| K-DATE          | Rendering a stored timestamp never throws. `new Date(x).toISOString()` raises on invalid input and unmounts the whole React tree.                                                                                                                                            | `isoTimestamp` / `parseTimestamp` in `src/shared/lib/time/timestamps.ts`                                                                                        | ast-grep `ts-date-toisostring-unguarded`                                                                      |
| K-CLOCK         | Durations and run limits are measured on a monotonic clock; wall-clock time jumps across sleep and clock changes. Schedulers detect a gap and skip missed occurrences instead of firing them all.                                                                            | `monotonicNow` / `elapsedSince` / `wallClockGap` in `src/shared/lib/time/timestamps.ts`                                                                         | oxlint `no-restricted-properties` (`Date.now` in scheduler modules)                                           |
| K-INTL          | Dates, times, numbers, byte sizes and durations are formatted by the shared helpers so every surface follows the app language and the same rounding.                                                                                                                         | `formatDate` / `formatNumber` (`src/shared/i18n/core.ts`), `formatRelativeTime` / `formatBytes` / `formatDuration` (`src/shared/i18n/format.ts`), `<Timestamp>` | ast-grep `ts-locale-format-outside-shared`                                                                    |
| K-LOCALE        | Child processes that match text run with `LC_ALL=C.UTF-8`, never `LC_ALL=C`, so case-insensitive matching of non-ASCII letters works and binary detection is byte-accurate.                                                                                                  | `LC_ALL: "C.UTF-8"`                                                                                                                                             | ast-grep `ts-lc-all-c`                                                                                        |
| K-I18N          | Translated text is never concatenated with literals; variable parts go through placeholders.                                                                                                                                                                                 | `t("Saved {p0} files", { p0: count })`                                                                                                                          | ast-grep `ts-i18n-concat`                                                                                     |
| K-EXTERNAL-LINK | External URLs open through one validated helper; no `target="_blank"`, `window.open` or direct opener imports in feature code.                                                                                                                                               | `openExternal` / `isExternalUrl` in `src/platform/tauri/openExternal.ts`                                                                                        | oxlint `no-restricted-imports` / `no-restricted-properties`; UI drift `target-blank`                          |
| K-LEDGER        | A receipt or registry map with a fixed capacity evicts settled entries by age; a cap that only grows turns into "works until restart". Idempotency windows must outlive any client retry window, not the process.                                                            | A TTL on settled entries (see the audit items P0-08, P0-10, P0-11, P0-14)                                                                                       | Review + regression test (no static rule yet)                                                                 |
| K-MULTI-WINDOW  | App-wide state (layout snapshot, in-flight sessions, automation recovery, lead election) is keyed by window or claimed once per process; a second window never overwrites or "recovers" another window's work.                                                               | Window-keyed rows, process-level recovery flag, Web Lock election (`syncWindowOwner.ts`)                                                                        | Review + regression test (no static rule yet)                                                                 |

## UI invariants

Component usage conventions from `docs/reference/ui-component-catalog.md` and
`docs/reference/ui-design-system.md` that `scripts/checks/check-ui-drift.mjs` and
`.oxlint-invariants.json` enforce. The older token rules (typography, radius, layer, colour,
motion, icons) are listed in `ui-design-system.md`.

| Rule (check)                                                          | Convention                                                                                                                    | Use instead                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `raw-native-control` (ui-drift)                                       | No raw `<button>`, `<input>`, `<select>`, `<textarea>` outside `src/shared/ui`                                                | `Button`, `TextField`, `TextareaField`, `Select` / `SearchableSelect`, `Checkbox` |
| `raw-anchor`, `target-blank` (ui-drift)                               | No raw `<a href>` or `target="_blank"` in feature code                                                                        | `Button variant="link"`, `openExternal()`                                         |
| `native-date-input` (ui-drift)                                        | No `type="date                                                                                                                | time                                                                              | datetime-local"` inputs | `DateTimePicker`, `DateRangePicker` |
| `UI-DIALOG` (oxlint `no-restricted-globals`)                          | No `alert`, `confirm`, `prompt`, `window.*` dialogs                                                                           | `useConfirm()` / `ConfirmDialog`, `InlineError`, `Alert`, `Toast`                 |
| `role-alert-text`, `role-alert-container`, `raw-aria-live` (ui-drift) | No hand-written `role="alert"` on p/span or div/small/li/section respectively, or `aria-live` on DOM elements in feature code | `InlineError`, `InlineMessage live=`, `Alert`, `LoadingText`, `Toast`             |
| `alert-role-prop` (ui-drift)                                          | `<Alert>` chooses `alert`/`status` from its tone; do not pass `role`                                                          | `<Alert tone="danger">`                                                           |
| `loader-icon-spinner` (ui-drift)                                      | No `Loader`/`Loader2`/`LoaderCircle` glyph as a spinner                                                                       | `Spinner`, `LoadingText`, `Skeleton`                                              |
| `native-title` (ui-drift)                                             | No `title=` on actions                                                                                                        | `tooltip=`, `Tooltip`, `useTooltip`                                               |
| `font-weight` (ui-drift)                                              | Weights 400 and 500 only                                                                                                      | `font-medium`                                                                     |
| `arbitrary-spacing`, `inline-style-layout` (ui-drift)                 | No arbitrary spacing values or literal layout numbers in `style={{}}`                                                         | Spacing scale, `--space-*` tokens, classes                                        |
| `focus-outline-removed` (ui-drift)                                    | Feature code never removes the focus outline                                                                                  | `data-ui-focus*` attributes; the ring contract in `arc.css`                       |
| `untranslated-jsx-text`, `untranslated-prop` (ui-drift)               | User-visible copy goes through `t()`                                                                                          | `const t = useT()`                                                                |
| `UI-MOTION` (oxlint `no-restricted-imports`)                          | No direct motion-library import in feature code                                                                               | Shared motion adapters and tokens                                                 |
| `react/no-danger` (oxlint)                                            | `dangerouslySetInnerHTML` only in the two reviewed sanitised renderers                                                        | Markdown / file-type renderers in the allowlist                                   |
| `jsx-a11y/*` (oxlint)                                                 | Clickable elements are keyboard-operable, have roles, labels and valid ARIA; no positive `tabIndex`                           | `Button`, `ActionHost`, `TreeRow`, `MenuRow`                                      |
| `no-console` (oxlint, UI files)                                       | No `console.log/info/debug` in UI components                                                                                  | `console.warn` / `console.error` for defects; runtime logs for diagnostics        |

## Adding or changing a rule

1. Start from a reproducible failure and write the sanctioned helper first, with a focused test.
2. Add the rule: structural patterns as `scripts/checks/invariants/rules/<lang>-<name>.yml`
   (ast-grep; `language: tsx` covers `.ts` and `.tsx`), API bans in `.oxlint-invariants.json`,
   component-usage regexes in `check-ui-drift.mjs` with a unit test in `check-ui-drift.test.mjs`.
   Messages are English and name the alternative and the rule ID.
3. Calibrate on the tree: `pnpm check:invariants -- --report`. Fix false positives before
   baselining; a rule with more noise than signal is removed, not baselined.
4. Record the current debt: `node scripts/checks/check-invariants.mjs --update-baseline` (or
   `check-ui-drift.mjs --update-baseline`) and review the diff.
5. Document the rule in the table above and, for UI conventions, in `ui-design-system.md`.

Rust static rules run without compiling (ast-grep parses the source), so they also run on hosts
without the GTK/WebKit development packages. When a Rust rule's baseline reaches zero, promote it
to `clippy.toml` `disallowed-methods` so the compiler enforces it with type information.

## Not covered by a static rule

These need a regression test with every fix; the audit record in
`temp/local/app-audit-2026-11-03/TODO.md` lists the concrete cases:

- Lifetime-capped maps without TTL eviction (K-LEDGER).
- Multi-window writers of a single app-wide row (K-MULTI-WINDOW).
- Schedulers that replay every missed occurrence after sleep.
- Per-turn inactivity watchdogs for provider processes.

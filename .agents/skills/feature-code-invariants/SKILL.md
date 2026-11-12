---
name: feature-code-invariants
description: Use when changing enforced code rules, checks and baselines. Not for package boundaries; see feature-platform-foundation.
---

# Code invariants development

Use for `pnpm check:invariants`, `pnpm check:ui-drift` failures, new structural rules and the
helpers the rules sanction. Theme tokens and shared control APIs belong to `feature-shared-ui`
and `feature-theme-foundation`; CI selection belongs to `feature-platform-foundation`.

## Source starts

- `docs/reference/rules.md`: the generated list of every enforced rule (`scripts/checks/rule-index.mjs`). `docs/reference/code-invariants.md`: rationale, sanctioned helpers and suppression form.
- `scripts/checks/oxlint-plugin/` (repository TypeScript rules, one file per rule), `scripts/checks/lint-config.mjs` (the `lint` and `fmt` blocks of `vite.config.ts`, run by Vite+: plugin switches, restricted APIs, jsx-a11y) and `scripts/checks/invariants/rules/*.yml` (ast-grep, Rust), run by `scripts/checks/check-invariants.mjs` against `scripts/checks/invariants-baseline.json`.
- `scripts/checks/check-ui-drift.mjs` (`rules` map, `scanFile`) with `check-ui-drift.test.mjs` and `scripts/checks/ui-drift-baseline.json`.
- Helpers: `src/platform/tauri/listenWindow.ts`, `src/platform/tauri/openExternal.ts`, `src/shared/lib/text/truncate.ts`, `src/shared/lib/time/timestamps.ts`, `src/shared/i18n/format.ts`, `host/storage/atomic-write.ts`.

## Workflow

1. A failing check names the rule and the alternative. Fix the code with the sanctioned helper; suppress a single line only with `-- <reason>` when the pattern is correct in that spot.
2. For a new rule: reproduce the defect, write or extend the helper with a focused test, add the rule with an English message that names the helper and the rule ID, calibrate with `node scripts/checks/check-invariants.mjs --report`, then `--update-baseline` and review the diff.
3. UI conventions go into `check-ui-drift.mjs` with accepted and rejected fixtures in its test; TypeScript patterns go into the oxlint plugin; Rust patterns into ast-grep rules, which run without compiling.
4. Define a rule once: widen an existing rule before adding one, then regenerate the list with `node scripts/checks/rule-index.mjs --write`. Add the rationale to `code-invariants.md`.

## Preserve

- Baselines only fall. Never raise a bucket to make a check pass; never baseline an error.
- Tool diagnostics without a file/rule (including invalid UTF-8) fail with their actual error; never discard them or convert them into baseline findings.
- Rules describe a defect class with a known alternative; advisory style preferences stay out of the gate (a rule with more noise than signal is removed, not baselined).
- Helpers keep their contracts: `listenWindow` disposers are synchronous and race-safe; `writeFileAtomic` fsyncs before rename; `readStateFile`/`readStateFileSync` distinguish missing, corrupt and unreadable state. Optional evidence copies never remove the source; security state stays closed until repaired, and genuine I/O errors remain explicit; `truncateGraphemes` never emits an unpaired surrogate; `isoTimestamp` never throws; `formatRelativeTime`/`formatBytes` follow the app locale.
- Rust rules are static; when a Rust bucket reaches zero, promote the rule to `clippy.toml` `disallowed-methods` so the compiler enforces it.

## Focused checks

`pnpm check:invariants`, `pnpm check:ui-drift`, `node --test scripts/checks/check-ui-drift.test.mjs`,
`node --test scripts/checks/check-invariants.test.mjs`, and the helper tests under
`src/platform/tauri`, `src/shared/lib/text`, `src/shared/lib/time`, `src/shared/i18n`,
`host/storage`. `check-local` runs the invariants and UI drift ratchets on changed files.

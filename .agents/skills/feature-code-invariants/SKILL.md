---
name: feature-code-invariants
description: Add, calibrate or satisfy the enforced code invariants (window-scoped events, atomic state files, lossy UTF-8 readers, monotonic durations, grapheme truncation, shared formatters, component-usage conventions) and their ratcheted checks. Use when a check fails, when a fix needs a new rule, or when writing a helper the rules point to.
---

# Code invariants development

Use for `pnpm check:invariants`, `pnpm check:ui-drift` failures, new structural rules and the
helpers the rules sanction. Theme tokens and shared control APIs belong to `feature-shared-ui`
and `feature-theme-foundation`; CI selection belongs to `feature-platform-foundation`.
Source paths are repository-relative.

## Source starts

- `docs/reference/code-invariants.md`: the rule index, sanctioned helpers and suppression form.
- `scripts/checks/invariants/rules/*.yml` (ast-grep, TypeScript + Rust) and
  `.oxlint-invariants.json` (restricted APIs, jsx-a11y), run by `scripts/checks/check-invariants.mjs`
  against `scripts/checks/invariants-baseline.json`.
- `scripts/checks/check-ui-drift.mjs` (`rules` map, `scanFile`) with `check-ui-drift.test.mjs` and
  `scripts/checks/ui-drift-baseline.json`.
- Helpers: `src/platform/tauri/listenWindow.ts`, `src/platform/tauri/openExternal.ts`,
  `src/shared/lib/text/truncate.ts`, `src/shared/lib/time/timestamps.ts`,
  `src/shared/i18n/format.ts`, `host/storage/atomic-write.ts`.

## Workflow

1. A failing check names the rule and the alternative. Fix the code with the sanctioned helper;
   suppress a single line only with `-- <reason>` when the pattern is correct in that spot.
2. For a new rule: reproduce the defect, write or extend the helper with a focused test, add the
   rule with an English message that names the helper and the rule ID, calibrate with
   `node scripts/checks/check-invariants.mjs --report`, then `--update-baseline` and review the diff.
3. UI conventions go into `check-ui-drift.mjs` with accepted and rejected fixtures in its test;
   platform patterns go into ast-grep rules (`language: tsx` covers `.ts` and `.tsx`; Rust rules
   run without compiling).
4. Document the rule in `code-invariants.md` (and `ui-design-system.md` for UI conventions).

## Preserve

- Baselines only fall. Never raise a bucket to make a check pass; never baseline an error.
- Rules describe a defect class with a known alternative; advisory style preferences stay out of
  the gate (a rule with more noise than signal is removed, not baselined).
- Helpers keep their contracts: `listenWindow` disposers are synchronous and race-safe;
  `writeFileAtomic` fsyncs before rename and `readStateFile` quarantines instead of throwing;
  `truncateGraphemes` never emits an unpaired surrogate; `isoTimestamp` never throws;
  `formatRelativeTime`/`formatBytes` follow the app locale.
- Rust rules are static; when a Rust bucket reaches zero, promote the rule to `clippy.toml`
  `disallowed-methods` so the compiler enforces it.

## Checks

`pnpm check:invariants`, `pnpm check:ui-drift`, `node --test scripts/checks/check-ui-drift.test.mjs`,
`node --test scripts/checks/check-invariants.test.mjs`, and the helper tests under
`src/platform/tauri`, `src/shared/lib/text`, `src/shared/lib/time`, `src/shared/i18n`,
`host/storage`. `check-local` runs the invariants and UI drift ratchets on changed files.

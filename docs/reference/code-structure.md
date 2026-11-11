# Code structure

Where code goes, when to split it and which layer may import which. These rules
exist because an audit on 2026-11-05 found feature code scattered into flat 5,000 to
14,000 line files (`host/server.ts`, `host/tasks/tasks.ts`, `src-tauri/src/fs.rs`,
`src/app/shell/Sidebar.tsx`) that every unrelated fix had to touch. The rules apply to
every contributor and every agent. `pnpm check:structure` enforces them as a ratchet
over `scripts/checks/code-structure-baseline.json`: existing debt is counted per file
and rule, new findings fail, and the baseline may only fall.

## Tech stack

| Layer                                     | Stack                                                                                                                                                                                                                                                 | Checked with                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Desktop UI (`src/`)                       | React 19, TypeScript 7 via `tsc-rs`, Vite+ (Vite 8, Vitest, Oxlint, Oxfmt behind `vp`), Tailwind 4 with shared CSS variables in `src/styles/`, Arc adapters under `src/shared/ui/arc/`, zustand and TanStack Query, custom i18n in `src/shared/i18n/` | `pnpm check:web`, `vitest`, oxlint/oxfmt                  |
| Host runtime (`host/`)                    | Node 24.11+, TypeScript, no React, bundled by `host/build.mjs`; HTTP/WS/native adapters over domain services                                                                                                                                          | `pnpm host:build`, `pnpm test:host`, host boundary checks |
| Native (`src-tauri/`)                     | Tauri 2, Rust 2021 workspace, sibling `foo.rs` + `foo/` module folders, tests in `*_tests.rs`                                                                                                                                                         | `pnpm check:rust`                                         |
| Workspace packages (`packages/`, `apps/`) | `@bycoda/core` portable helpers, `@bycoda/account-contracts` client API contract (zod schemas, activity bitmap, mock server), Rust/Node native packages, desktop entry metadata                                                                       | `pnpm check:packages`                                     |
| Mobile (`mobile/`)                        | Separate Expo repository with its own rules and checks                                                                                                                                                                                                | `pnpm typecheck` from `mobile/`                           |

Layout ownership is in [repository layout](repository-layout.md) and `.artifact`; Host
internals in [host runtime](host-runtime.md); UI ownership in
[ui-design-system](ui-design-system.md).

## One feature, one folder per layer

A feature is named once and keeps that name in every layer it touches. Code for a
feature never lands in a shared file because that file already exists.

| Layer  | Location                                                 | Internal convention                                                                                                                                                                                                                                                         |
| ------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI     | `src/features/<feature>/`                                | `model/` pure TypeScript and its tests, `ui/` components and CSS, optional `hooks/`, `data/` or `runtime/` for I/O glue. `index.ts` declares the public types, deferred loaders and exact `public/<contract>.ts` runtime entries. No other loose files at the feature root. |
| Host   | `host/<feature>/`                                        | Service, storage, scheduling and tests of that feature. `host/domains/<feature>/service.ts` stays the thin wire-facing layer; `host/server.ts` and `host/engine.ts` only compose. No new loose files at `host/` root.                                                       |
| Native | `src-tauri/src/<feature>/` with a sibling `<feature>.rs` | New `#[tauri::command]` handlers go in the owning module folder, not in `fs.rs`, `harness.rs`, `session_store.rs` or `remote.rs`.                                                                                                                                           |
| Shared | `src/shared/`, `packages/core/`                          | Only code used by two or more features with no feature-specific state.                                                                                                                                                                                                      |

Feature names follow the UI folder: `voice`, `source-control`, `social`, `devices`,
`tasks`, `inbox`, `crews`, `dev-servers`, `workspaces`. Where a Host folder still uses
another name (`host/git/` for source control), move toward the UI name when the folder
is next touched; do not create a third location.

Before adding to a file, ask which feature owns the change. If the answer is a feature
and the file is `server.ts`, `engine.ts`, `App.tsx`, `Sidebar.tsx`, `settings.ts` or any
`*.rs` root module, the change belongs in the feature folder and the shared file gets a
one-line registration at most.

## When to split

Split by design, not by line count. The questions, in order:

1. **Does this part have its own responsibility?** Parsing, persistence, scheduling,
   transport and rendering are separate modules. A toolbar, a list row, a dialog body
   and an empty state are separate components.
2. **Does it own its own state?** State lives in the smallest part that needs it.
   Siblings never write each other's state; they communicate through props, callbacks
   or a store. One component holding every `useState` of a screen lets any change
   re-render and break unrelated parts, so move each group of state with the UI that
   uses it into a child component or a hook.
3. **Does a second place need it?** Then it is a reusable piece, not a copy: a
   component or hook in the feature's `ui/` or `hooks/`, or in `src/shared/` once two
   features use it. Design its props for the second caller, not only the first.

A unit that answers "no" to all three stays whole, however long it is. Do not cut a
cohesive unit into `Part1`/`Part2` files, and do not pass a dozen props and setters
down just to move lines: that keeps the coupling and hides it.

Review triggers that are not gated: a component with more than fifteen `useState`
calls, more than one exported component per `ui/` file, a `model/` file importing
React, inline Rust test modules over 500 lines.

## File size

Line counts are a hint to ask the questions above, not a rule to obey.

| File kind              | Target (advisory) | Hard ceiling (gated) | Rule name in the check |
| ---------------------- | ----------------- | -------------------- | ---------------------- |
| `.tsx` component file  | 600 lines         | 1,200 lines          | `tsx-file`             |
| `.ts`, `.mts`, `.mjs`  | 800 lines         | 1,600 lines          | `ts-file`              |
| TypeScript test file   | 1,500 lines       | 3,000 lines          | `ts-test-file`         |
| Rust production module | 1,500 lines       | 3,000 lines          | `rust-file`            |
| Rust `*_tests.rs`      | 3,000 lines       | 6,000 lines          | `rust-test-file`       |

- Over a target: the check prints a note for changed files and never fails. Split if a
  separable responsibility exists; otherwise continue. A line count is never a reason
  to refuse, shrink or delay requested work.
- Over a hard ceiling (twice the target): gated. No new file may cross it. Files already
  over it are listed in the baseline with their line count and may grow by up to 50
  lines past that count, so a fix or a small needed addition goes in place without a
  detour. A new responsibility goes into the owning feature folder instead. The room is
  not renewed by `--ratchet`; moving a part out lowers the count and frees it again.

## Import boundaries

| Rule                                    | Meaning                                                                                                                                             | Gated |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `foundation-imports-app`                | `src/shared/`, `src/platform/`, `src/integrations/` must not import `src/features/` or `src/app/`. Lift the shared part into `src/shared/` instead. | yes   |
| `feature-imports-app`                   | `src/features/` must not import `src/app/`. The app composes features; features receive what they need through props, stores or shared modules.     | yes   |
| `host-imports-ui`                       | `host/` must not import `src/app/` or any `src/features/*/ui/`. Share through `src/shared/model/host-contracts`.                                    | yes   |
| `cross-feature-deep-import`             | A feature imports a peer file not declared as a public entry.                                                                                       | yes   |
| `loose-host-file`, `loose-feature-file` | A non-test `.ts`/`.tsx` sits directly under `host/` or `src/features/<feature>/`.                                                                   | yes   |

Portable Host roots and headless CLI isolation stay with
`scripts/checks/check-host-runtime-boundaries.mjs` and
`scripts/checks/check-host-headless-boundaries.mjs`; this check does not duplicate them.

Cross-feature imports may use feature root paths or exact `public/<contract>.ts` entries declared by the target feature's `index.ts` with `export type * as <api> from "./public/<contract>"`. These type-only declarations list contracts without eagerly loading their runtime modules. Keep each public entry narrow to limit its dependency graph.

## Writing code that stays small

- One module, one responsibility: parsing, persistence, scheduling, transport and
  rendering are separate files even when they serve one feature.
- Put the new thing next to its tests. A new behavior ships with a focused test in the
  same folder; a defect fix for one of the invariant classes adds a regression test
  ([code invariants](code-invariants.md)).
- Prefer extracting a hook, a pure function or a child component over adding another
  `useState` to a 3,000-line component.
- Use the sanctioned helpers (`listenWindow`, `writeFileAtomic`, `readStateFile`,
  `elapsedSince`, `truncateGraphemes`, shared i18n formatters, `openExternal`) and the
  shared UI controls; never a local copy.
- Do not add a module-level singleton, cache or registry to a UI file. They live in
  `model/`, `data/` or `runtime/` with a reset hook for tests.
- Comments explain why, not what. English for code, rules and documentation.

## Commands

| Command                                     | Effect                                                                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:structure`                      | Gate against the baseline (part of `check:web` and CI)                                                                                                    |
| `pnpm check:structure -- --report`          | Totals per rule and owner, the 25 largest files over the hard ceiling, count of files over target                                                         |
| `pnpm check:structure -- --files a.ts b.rs` | Only the given files (what `check-local` runs for changed files)                                                                                          |
| `pnpm check:structure -- --ratchet`         | Lower baseline buckets after a cleanup; never raises                                                                                                      |
| `pnpm check:structure -- --update-baseline` | Rewrite the baseline. Only for an owner-approved exception or a new rule; review the diff and record any rise in `scripts/checks/baseline-approvals.json` |

A baseline count that goes up is a review finding, not an accepted exception. Rules
and gating decisions change here first, then in the check; a new gated rule needs
accepted and rejected fixtures in `scripts/checks/check-code-structure.test.mjs` and a
reviewed baseline, per [quality](quality.md).

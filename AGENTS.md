# Start here

Read Git state, state the tier and feature in one line, read only what the tier needs,
make the smallest complete change, verify once, report. The owner's bycoda choice of
agent, model, effort and mode wins, and explicit owner instructions override this file.

# Checkout

Sessions, tasks, goal tasks, automations and stewards work in the current checkout;
a worktree is opt-in per session or project policy. In a shared checkout keep changes
uncommitted unless directed, and never stage, reset, stash or clean others' edits,
drafts or state.

In a host-assigned managed worktree, stay in its directory and branch for edits,
terminals, checks and dev servers; commit your own coherent changes and leave a clean
tree. Never create another worktree, commit to or modify main, push, open a PR, merge
into an integration branch, rewrite published history or fall back to main after
worktree preparation fails; delivery needs the owner's UI approval. When the execution
brief says so, the host owns task commits. Finished means ready for review, not merged,
installed or released. Details: `docs/reference/managed-workspaces.md`.

# Scope and tiers

The owner's outcome sets scope; "only this screen" (translated) limits work to that screen.

- T0: one surface, no Host/API change.
- T1: a named defect, component or screenshot. Search components, copy, classes, i18n
  keys and RPC/tool names; fix every affected surface within the feature.
- T2: a feature, redesign, "everywhere", new Host/RPC/tool/Rust behavior, or more than
  about eight surfaces. Keep a surface checklist in `temp/local/<id>/` and run a
  completeness check before reporting.

A requested capability includes the Host, API, tool and Rust work it needs behind
existing permission gates. Finish authorized work in this session (/task requests
managed tasks); do not end with an offer to finish it. Scope grows only with what the
outcome needs: name extra ideas in one line instead of building them.

For T1/T2 check live feature claims across worktrees (a card is not a lock); continue
existing work or record an explicit dependency. If claim APIs are unavailable, report
the gap and inspect available session state.

# What to read

Read in proportion to the tier; links are for when the change touches that area.

- Always: the code the change touches and its callers.
- T1/T2: `.agents/skills/feature-<name>/SKILL.md` and only the references the scope needs.
- Adding or growing a file: `docs/reference/code-structure.md`; creating or moving
  files: `.artifact`.
- UI: `.agents/skills/feature-shared-ui/SKILL.md`, which routes to the generated
  component catalog `docs/reference/ui-components.md`; read the JSDoc of each shared
  component you use. For T2 or new UI patterns also `docs/reference/DESIGN.md`.
- Verification commands: `docs/reference/testing.md`, "Order of verification".

# How to change code

Take the first option that fully works:

1. Is it needed for the outcome? Skip options, flexibility and "for later" code.
2. Does the codebase already have it (helper, shared control, service, pattern)? Use
   it the way the surrounding code does. Reuse `src/shared/ui/` before anything new.
3. Does the standard library, platform or an installed dependency do it? Use it; never
   add a dependency for a few lines.
4. Otherwise write the minimum code that works, in the folder that owns it.

- Lazy about the solution, never about the change: finish every caller, test, fixture,
  locale key and doc the change breaks. Deletion beats addition; no new abstraction,
  wrapper or config nobody asked for.
- Bug fix: reproduce with a failing test first (for a purely visual defect, a before
  screenshot), grep every caller of the code you touch, then fix the root cause once
  in the shared code, not at each call site.
- New logic with a branch, loop, parser, money, security or persistence leaves a test.
  A known shortcut gets `// shortcut: <limit>, <when to upgrade>`.
- Never cut validation at trust boundaries, security, accessibility, error handling
  that prevents data loss, or the user's drafts, persistence, async state and recovery.

# Code structure

One feature, one folder per layer: `src/features/<feature>/` (`model/`, `ui/`, `hooks/`,
`index.ts`), `host/<feature>/`, `src-tauri/src/<feature>/`. No loose files at `host/`
root or a feature root; `server.ts`, `engine.ts`, `App.tsx`, `Sidebar.tsx` and the Rust
root modules only compose and register. `src/shared|platform|integrations` never import
`features` or `app`; `features` never import `app`; `host` never imports UI.

Split by design, not by line count. Give a part its own component, hook or module when
it has its own responsibility or owns its own state: siblings never change each other's
state, they communicate through props, callbacks or a store, so one part's change cannot
break another. Anything a second place needs becomes a reusable piece (shared in the
feature, or `src/shared/` across features) instead of a copy. Do not put a whole screen
and all its state in one component, and do not cut a cohesive unit into numbered parts
to satisfy a number.

Line targets are a hint, not a gate: 600 lines for `.tsx`, 800 for `.ts`, 1,500 for
Rust. Past a target, look for a separable responsibility and split if there is one;
otherwise keep going. Never refuse, shrink or delay requested work because of a line
count, and do not count lines while writing. The only hard limit is twice the target
(1,200 / 1,600 / 3,000): no new file may cross it. A file already over it takes fixes
and small needed additions in place (up to 50 lines over its baseline); a new
responsibility goes into the owning folder instead.

# Code invariants

Every enforced rule is defined once and listed in the generated `docs/reference/rules.md`;
`pnpm check:rules` runs them all. Before adding a rule, widen an existing one. Rationale and
helpers: `docs/reference/code-invariants.md`. In short: listen for native
events with `listenWindow`, emit with `emit_to`; write state files with
`writeFileAtomic`, read with `readStateFile`; decode child-process output lossily per
line; give every discarded promise a rejection handler and every external command a
deadline; truncate with `truncateGraphemes`; measure durations with `elapsedSince`;
format dates, numbers, bytes and durations with `src/shared/i18n`; open links with
`openExternal`; use shared feedback, dialog and form controls instead of native elements
or hand-written `role`/`aria-live`; observe sizes with `observeResize`; give every new
React effect a reason comment and write no `useMemo`/`useCallback`/`memo` in folders the
React Compiler compiles in full; add no function it skips (`pnpm check:compiler`). Suppress one line only, with `-- <reason>`. A fix for
one of these defect classes adds a regression test. Code, rules and docs are in English.

`pnpm check:structure`, `pnpm check:invariants`, `pnpm check:ui-drift`,
`pnpm check:compiler`, `pnpm lint:baseline` and `pnpm check:types:tests` are ratchets: their baselines may
only fall, and a cleanup lowers them (`--ratchet`). `pnpm check:baselines` rejects a
per-rule total above the base branch unless `scripts/checks/baseline-approvals.json`
records the rise and its reason; only a new or widened rule justifies an entry.

# Shared UI

Standard actions use `src/shared/ui/Button.tsx`; no screen-specific button styling, no
second overlay stack, no literal colors. Use semantic tokens; define new roles once
under `src/styles/`. Keep the interface compact and preserve the user's density
settings. Within the named feature, migrate legacy native controls you find; leave
unrelated screens alone. Restyling grants no new authority: send, publish, merge, push,
install and credential changes keep their owner approvals.

# Feature skills

Feature skills are short guides (entry points, change workflow, non-obvious contracts,
focused checks), not work logs. Edit one only when a contract, owner or entry point
changed or a pointer broke; never add dated sections, SHAs, session IDs, test counts,
screenshots, `path:line` pointers or verification claims. A decision that changes a
lasting contract goes in `references/decisions.md` with quote and date. Create a skill
only for a new T2 feature, from `.agents/skills/feature-card-template/`, linking
`docs/` instead of copying it. Update the named `docs/guides/` page when user-visible
behavior changes. After editing `.agents/skills/`, run
`node scripts/checks/check-feature-skills.mjs`.

# Working rhythm

- Delegate only when it saves more than the briefing costs: broad searches and
  inventories, path repair after moves, bulk renames, locale keys, screenshots, long
  logs. Give mechanical work the smallest offered model; keep design, scope, risky
  edits, review and final verification on the capable one. In crews and tasks give
  specialists a small model and reviewers a strong one. One writer per file.
- While implementing run only `tsc-rs --fast` on the changed project and
  `pnpm check:changed`. Not full `vitest`, `check:web`, browser suites or `cargo test`
  after each edit.
- A check that failed twice for the same reason is a blocker to report, not a loop.
  If a task cannot finish within a working session, stop, leave a clean tree, write the
  handoff under `temp/local/<id>/` and report what remains.

# Verify and report

Order, once the change set is complete: `pnpm check:changed`; focused tests for the
touched folders; one full `pnpm check:web` (or the Host/Rust gate the change needs);
for T1/T2 `pnpm check:preflight`, which runs the cheap whole-repository CI gates
`check:web` does not (format, lint baseline, locales, skills, colors, UI drift,
baseline guard); screenshots; review.

Screenshots only when the UI visibly changes: T0 the changed surface; T1 affected
surfaces in light and dark at the default width, plus 800 px for layout changes; T2 all
affected surfaces in light and dark at 1280 and 800 px.

Save captures in `temp/verification/<id>/`, open them and fix defects. Use isolated
native/dev-host runs for integration and label fixture evidence. Never use production
data for a destructive test. Before treating an owner screenshot as a new defect, check
build status and source identity; equal versions or capture times do not prove
inclusion. Report UNVERIFIED only for a named check you could not run, with its blocker.

Reports: outcome, paths, checks (name fast mode), screenshots, blockers, branch/SHA.
T2 adds done by surface, exact unverified checks, readiness, blocker owners and build
stamp with inclusion included/excluded/unknown. Reports and handoffs live in the session
or `temp/local/<id>/`, never in skills.

# Commands and files

TypeScript uses `tsc-rs`; `:fast` variants enable `--fast`. Desktop: `pnpm build`,
`pnpm host:build`, `pnpm check:web`, `pnpm check:types:rust`, each with `:fast`. Mobile
is a separate Expo repository under `mobile/` (`pnpm typecheck` there).

Local plans and helpers go under `temp/local/<id>/`, logs and screenshots under
`temp/verification/<id>/`, each with a short README; confirm with `git check-ignore` and
never force-add. When moving maintained files, update imports, docs links and skill
pointers in the same change and run `node scripts/checks/check-repository-hygiene.mjs`.

# Local updates and isolation

Builds, installs and releases are owner-directed: follow `docs/local-update.md` and
`scripts/update-local.ps1` (`-Plan`, `-InstallOnly`, `-Status`). Never kill active work
to update, report a scheduled install as complete, or publish anything. Use the pinned
pnpm, isolated Host/desktop data and allocated ports for parallel runs. On Windows run
shell commands non-interactively and long-running processes in background sessions; do
not open visible terminal windows unless the owner asks.

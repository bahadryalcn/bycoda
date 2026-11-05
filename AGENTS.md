# Start here

Every task follows this order; each step links the section that owns it.

1. Read Git state and live feature claims; never touch others' edits (Checkout workflow).
2. State the tier and the feature in one line (Scope, tiers and done).
3. For T1/T2 read the feature skill; for new files read `docs/reference/code-structure.md`
   (Feature skills, Code structure).
4. Implement completely, delegating mechanical parts to small models, running only
   fast changed-file checks meanwhile (Working rhythm).
5. Verify once in the documented order, capture evidence by tier, then report or hand
   off within the time budget (Working rhythm, Scope, tiers and done).

# Checkout workflow

Sessions, tasks, goal tasks, writing automations and stewards default to the current
checkout. Worktree is opt-in per session or project policy. Inspect Git state first.
In shared checkouts, keep changes uncommitted unless directed otherwise. Preserve
others' edits, drafts and state; never stage, reset, stash or clean them.

In a host-assigned managed worktree, use its directory/branch; do not create another
or change branches. Run edits, terminals, checks and dev servers there. Commit your
own coherent changes and leave a clean tree at handoff. Never modify main from
another workspace, commit to main, push, create a PR or merge into an integration
branch; delivery requires the owner's UI approval. Never rewrite published history or
fall back to main after worktree preparation fails. Stay in a host-assigned task
workspace; the host owns task commits when the execution brief says so. Explicit
owner instructions take precedence. Finished means ready for review, separate from
merged, installed or released. Details: `docs/reference/managed-workspaces.md`.

# Scope, tiers and done

The owner's outcome sets scope. A screenshot is one example; "sadece bu ekran"
limits work to that screen. Start by stating the tier and the feature.

- T0: one surface, no Host/API change. Complete and verify it.
- T1: a named defect, component or screenshot. Search components, copy, classes,
  i18n keys and RPC/tool names; fix every affected surface within the feature.
- T2: a feature, redesign, "everywhere", new Host/RPC/tool/Rust behavior, or more
  than about eight surfaces. Keep a surface checklist in `temp/local/<id>/` and run a
  completeness check before reporting.

For T1/T2 read the feature's `.agents/skills/feature-<name>/SKILL.md` and only the
references the scope needs. Check live feature claims across worktrees; a card is not
a lock. Continue existing work or record an explicit dependency. If claim APIs are
unavailable, report the gap and inspect available session state.

A requested capability includes the Host, API, tool and Rust work it needs behind
existing permission gates. Preserve functions, drafts, persistence, validation, async
state and recovery. Complete authorized work; do not stop at a screenshot or end with
an offer to finish it. /task requests managed tasks; otherwise finish in this session.
Delegate independent parts with one writer per file.

Done means exercised, scaled by tier:

- T0: focused code checks; one screenshot of the changed surface only for visual
  changes. Short report.
- T1: focused checks and screenshots of affected UI surfaces in light/dark at the
  default width; add 800 px only for layout changes.
- T2: focused checks; screenshots of all affected UI surfaces in light/dark at 1280
  and 800 px; the full report below.

Save captures in `temp/verification/<id>/`, open them and fix defects. Use isolated
native/dev-host runs for integration; label fixture evidence. Report UNVERIFIED only
for a named check you could not run and its concrete blocker. Never use production
data for a destructive test. Check build status and source identity before treating
an owner screenshot as a new defect; equal versions or capture times do not prove
inclusion. Build/install/release remain owner-directed actions.

T0/T1 reports briefly state outcome, paths, checks, screenshots, blockers and
branch/SHA. T2 reports also list done by surface, exact unverified checks, readiness,
blocker owners and build stamp with inclusion marked included/excluded/unknown.
Reports and handoffs live in the session or `temp/local/<id>/`, never in skills.

# Feature skills: read often, write rarely

Feature skills are short developer guides: entry points, change workflow, the
non-obvious contracts and focused checks. They are not work logs.

- Edit a skill only when a contract, owner or entry point changed, or a pointer broke.
  A fix or perf change that is covered by its regression test adds no bullet.
- Never add dated sections, commit SHAs, session IDs, test counts, screenshots,
  `path:line` pointers or verification claims. Owner decisions go in the task handoff;
  only a decision that changes a lasting contract is recorded, with quote and date, in
  `references/decisions.md`.
- Create a skill only for a new T2 feature, using
  `.agents/skills/feature-card-template/SKILL.md`. Reuse `docs/reference/` and
  `docs/guides/` by link; do not copy them.
- Update the named user guide in `docs/guides/` when user-visible behavior changes.
- After editing anything under `.agents/skills/`, run
  `node scripts/checks/check-feature-skills.mjs`.

# Code structure

Read `docs/reference/code-structure.md` before adding a file or growing one. One
feature, one folder per layer: `src/features/<feature>/` (`model/`, `ui/`, `hooks/`,
`index.ts`), `host/<feature>/`, `src-tauri/src/<feature>/`. No loose files at `host/`
root or a feature root; `server.ts`, `engine.ts`, `App.tsx`, `Sidebar.tsx` and the
Rust root modules only compose and register. Ceilings: 600 lines for `.tsx`, 800 for
`.ts`, 1,500 for Rust. Files already over budget may not grow; move the part you touch
into the owning folder. `src/shared|platform|integrations` never import `features` or
`app`; `features` never import `app`; `host` never imports UI. `pnpm check:structure`
is a ratchet whose baseline may only fall.

# Working rhythm: cheap first, verify once, stop on time

The owner picks the session's agent, model, effort and mode in bycoda; that choice
wins. Inside the session, spend capability where it matters:

- Delegate mechanical work (search and inventory, path repair after moves, renames,
  locale keys, boilerplate, formatting, screenshots, log reading) to the smallest
  model offered for subagents, tasks or crew members. Keep design, scope decisions,
  risky edits, review and final verification on the capable model. When defining a
  crew or task, give specialists a small model and reviewers a strong one; do not
  let every role inherit the first catalog model.
- Build first, verify once. While implementing, run only `tsc-rs --fast` on the
  changed project and `pnpm check:changed` (bounded changed-file checks). Do not run
  the full `vitest`, `check:web`, browser suites or `cargo test` after every edit.
- Verification order when the change set is complete: `check:changed`; focused
  tests for the touched folders by path filter; one full `pnpm check:web` (or the
  Host/Rust gate the change needs); screenshots; then review. Details and commands:
  `docs/reference/testing.md`, section "Order of verification".
- Time budget. A single task runs at most a working day. If it is not finished,
  stop, leave a clean tree, write the handoff under `temp/local/<id>/` and report
  what remains; do not keep iterating for days. A check that has failed twice for the
  same reason is a blocker to report, not a loop to retry.

# Checks and file placement

Use `tsc-rs` for TypeScript. Normal mode is default; `:fast` commands enable
`tsc-rs --fast`. Desktop commands are `pnpm build`, `pnpm host:build`,
`pnpm check:web`, `pnpm check:types:rust`, each with a `:fast` variant. Mobile is a
separate Expo repository under `mobile/` using `pnpm typecheck` from there. Name fast
mode in reports.

Read `.artifact` before creating or moving files. Local plans and helpers go under
`temp/local/<id>/`, logs and screenshots under `temp/verification/<id>/`, each with a
short README. Confirm outputs with `git check-ignore`; never force-add them. When
moving maintained files, update imports, docs links and skill pointers in the same
change and run `node scripts/checks/check-repository-hygiene.mjs` before committing.

# Code invariants

`docs/reference/code-invariants.md` lists enforced rules and their helpers;
`pnpm check:invariants` and `pnpm check:ui-drift` are ratchets whose baselines may
only fall. In short: listen for native events with `listenWindow` and emit with
`emit_to`; write state files with `writeFileAtomic` and read with `readStateFile`;
decode child-process output lossily per line; give every discarded promise a
rejection handler and every external command a deadline; truncate with
`truncateGraphemes`; measure durations with `elapsedSince`; format dates, numbers,
bytes and durations with `src/shared/i18n`; open links with `openExternal`; use the
shared feedback, dialog and form controls instead of native elements or hand-written
`role`/`aria-live`. Suppress one line only, with `-- <reason>`. Code, rules and
documentation are written in English. A fix for one of these defect classes adds a
regression test.

# Shared UI

Read `docs/reference/DESIGN.md`, then the rules checklist at the top of
`docs/reference/ui-design-system.md`, `docs/reference/arc-ui.md` and the relevant
shared controls before UI work. Reuse `src/shared/ui/` first; standard actions use
`src/shared/ui/Button.tsx`; no screen-specific button styling, no second overlay
stack, no literal colors. Use semantic tokens; new roles are defined once under
`src/styles/`. Keep the interface compact and preserve the user's density settings.
Restyling grants no new operation authority; send, publish, merge, push, install and
credential changes keep their owner approvals. Within the named feature, migrate
legacy native controls you find; leave unrelated screens alone.

# Local updates and isolation

For owner-directed local builds/installs follow `docs/local-update.md` and
`scripts/update-local.ps1` (`-Plan`, `-InstallOnly`, `-Status`). Never kill active
work to update, report a scheduled install as complete, or publish anything. Use the
pinned pnpm, isolated Host/desktop data and allocated ports for parallel runs. On
Windows, shell calls use `exec_command` with `tty=true`; long-running sessions use
`write_stdin`; do not open visible terminal windows unless the owner asks.

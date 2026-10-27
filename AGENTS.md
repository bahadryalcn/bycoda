# Worktree-first workflow

Each new coding session or task works in its assigned Git worktree and branch.
Use the host-assigned workspace; do not create a second one or change branches.
Keep project identity separate from execution cwd. Run edits, terminals, checks
and dev servers in the execution worktree. Existing sessions in the main checkout
(`current` mode) keep working there without committing until explicitly migrated.

Inspect Git state before editing. You may stage and commit your own work on your
assigned branch with clear messages. Commit coherent changes and leave a clean
source tree at handoff. Never modify the main checkout from another workspace,
commit to main, push, create a PR or merge into an integration branch; delivery
requires the owner's UI approval. Do not rewrite published history.

Other branches may contain concurrent work. Read applicable cards and live feature
claims before starting; coordinate dependencies instead of duplicating a redesign.
Never edit or reset another workspace. Do not stash or clean work to make a check
pass. Stay in a host-assigned task workspace; the host owns task commits when the
execution brief says so. Explicit owner instructions take precedence.

Scale handoff detail to the tier below. Finished means ready for review, separate
from merged, installed or released. Leave directory retirement to the managed
lifecycle service. Detailed ownership, cleanup, recovery and development contracts
are in `docs/reference/managed-workspaces.md`.

# Scope, features and done

The owner's outcome sets scope. A screenshot is one example; "sadece bu ekran"
limits work to that screen. Start with tier, feature and estimated surface count;
include an applicable card path.

- T0: one surface, no Host/API change. Complete and verify it.
- T1: a named defect, component or screenshot. Search components, copy, classes,
  i18n keys and RPC/tool names; enumerate and fix every affected surface within
  the feature.
- T2: a feature, redesign, "everywhere", new Host/RPC/tool/Rust behavior, or more
  than about eight surfaces. Maintain a complete surface checklist and run a
  meaningful completeness check before reporting.

For named features, search skills and read recent Git history.
For T1/T2, read its existing `.agents/skills/feature-<name>/SKILL.md`. Check
live feature claims across worktrees; a tracked card is not a concurrency lock.
Continue existing work or record an explicit dependency/sub-scope. If claim APIs
are unavailable, report the coordination gap and inspect available session state;
do not pretend a local card reserves a feature. Create cards only for T2 using
`.agents/skills/feature-card-template/SKILL.md`. Card updates include delivered
behavior and commit references. Record owner decisions only with an
exact quote, date and session/source; label agent ideas as proposals. Update user
guides when behavior changes.

A requested capability includes the Host, API, tool and Rust work it needs behind
existing permission gates. Preserve functions, drafts, persistence, validation,
async state and recovery. Complete authorized work; do not stop at a screenshot
or end with an offer to finish it. /task requests managed tasks; otherwise finish
in this session. Delegate independent parts with one writer per file.

Done means exercised, scaled by tier:

- T0: focused code checks; one screenshot of the changed surface only
  for visual changes. No card; short report.
- T1: focused checks and screenshots of affected UI surfaces in light/dark at the
  default width; add 800 px only for layout changes. Update existing cards.
- T2: focused checks; screenshots of all affected UI surfaces in light/dark at 1280 and
  800 px; create/update the card and give the full report below.

Save captures in `temp/verification/<id>/`, open them and fix defects. Use isolated
native/dev-host runs for integration; label fixture evidence. Report UNVERIFIED
only for a named check you could not run and its concrete blocker. Never use
production data for a destructive test.

Check build status and source identity before treating an owner screenshot as a
new defect. Compare and exercise an already implemented change in the relevant
build instead of redesigning it. Equal versions or capture times do not prove
inclusion. Build/install/release remain owner-directed actions.

T0/T1 reports briefly state outcome, paths, checks, required screenshots,
blockers and branch/SHA. T2 reports also list done by surface with path:line,
exact unverified checks, readiness, blocker owners and build stamp with inclusion
marked included/excluded/unknown.

# Checks and file placement

Use `tsc-rs` for TypeScript compilation and checking. Normal mode is default;
`:fast` commands explicitly enable `tsc-rs --fast`. Desktop commands are
`pnpm build`, `pnpm host:build`, `pnpm check:web`, `pnpm check:types:rust`, each
with a `:fast` variant. Mobile uses `pnpm typecheck` or `pnpm typecheck:fast`
from `mobile/`. Preserve all other checks and name fast mode in reports.
Compiler API consumers may retain their TypeScript packages.

Read `.artifact` before creating or moving files. Project skills and feature
cards live in `.agents/skills/`. Keep local plans/helpers/research under
`temp/local/<id>/` and check logs/screenshots under `temp/verification/<id>/`,
with a short purpose/origin/reuse README. Preserve useful retired files under
`temp/archive/`. Confirm outputs with `git check-ignore`; never force-add them.
Update dependent paths when moving maintained files and run
`node scripts/checks/check-repository-hygiene.mjs` before committing.

# Shared UI and component reuse

Read `docs/reference/arc-ui.md` and inspect relevant shared controls before UI
work. Consult relevant ownership/control sections in
`docs/reference/ui-design-system.md` and `docs/reference/ui-component-catalog.md`.
Use Arc through bycoda's adapters and theme; distinguish target APIs from current
adapters. Keep the interface compact, minimal and modern.

- Choose controls for the task and Arc use-case guidance, reconsidering complete
  groups. Preserve capabilities, not tag/button counts. Compare segmented/radio
  choices, split actions and menus. Short stable lists may use Select; long,
  growing or name-searchable lists need Combobox/autocomplete; multiple values
  need searchable MultiSelect. Preserve free entry.
- Search `src/shared/ui/`, settings controls and the feature before creating a
  control. Reuse first, extend shared APIs for reusable gaps, and create a shared
  component only for a concrete unmet need. Standard actions use
  `src/shared/ui/Button.tsx` or a delegating wrapper. No screen-specific button
  styling or visual-only IconButton/ToolbarButton/CardAction duplicates; keep
  color, size, shape, focus, disabled and loading presentation centralized.
- Prefer shared TextField, TextareaField, SearchableSelect, settings controls and
  Arc adapters. Registry source belongs under `src/shared/ui/arc/`; application
  code uses adapters. Preserve native props and ref contracts. Native elements
  inside primitives/composites may retain required semantics and events. Tabs,
  trees, menus, window controls and drag targets keep keyboard, selection, focus,
  drag and native-window behavior; do not mechanically replace them with buttons.
- Reuse Popover, Modal, `overlay.ts` and native popup routing. Do not add another
  overlay stack, focus trap, Escape framework or dialog/menu library. Use shared
  appearance/motion tokens, icons and scoped `.bycoda-arc` roles; no global Arc
  foundation imports or copied design systems.
- Use shared semantic color tokens directly in CSS, Tailwind and inline styles.
  No literal hex/RGB/HSL/OKLCH/named colors, arbitrary color utilities, or local
  color-mix/opacity/gradient recipes inventing UI colors. Standard panel/card
  surfaces use `var(--ui-surface)`; use existing raised, hover, pressed, selected,
  text, border and status roles. Define genuinely new roles once in their owning
  shared theme under `src/styles/` (palette.css, index.css, bycoda.css or arc.css),
  supporting light/dark/custom themes. Keep mixing there and preserve neutral
  surface hues. These rules override generic skill color examples.
- Keep headers/actions compact. Collection filters and advanced options go in
  icon-triggered popovers with active indication and reset. Keep frequent actions
  direct; secondary actions use overflow menus. Icons need accessible names and
  tooltips; hover cannot be the only discovery/operation path.
- Remove repetitive instructions and decorative cards. Optional help uses an
  information control; long details use disclosure. Keep necessary labels,
  errors, operation/approval state and recovery visible. Compactness must retain
  fields, data, functions and drafts.
- Preserve state ownership, persistence, validation, async callbacks, permission
  gates and recovery. Restyling grants no new operation authority; requested
  capabilities include necessary Host/API/tool/Rust work behind existing gates.
  Loading controls prevent duplicate actions. Send, publish, merge, push, install
  and credential changes still require applicable owner authorization.
- Shared-control changes need representative consumers checked for keyboard use,
  narrow layouts, both themes and reduced motion. Use meaningful focused checks;
  avoid implementation-mirroring tests and unrelated release gates for docs.

Legacy native controls do not justify duplicates. Within the named feature,
migrate affected instances you find; leave unrelated screens alone.

# Local app/host updates and development isolation

For owner-directed local builds/installs, read `docs/local-update.md` and use
`scripts/update-local.ps1`: `-Plan` reviews options, `-InstallOnly` reuses its
package, `-Status` reports actual completion. Preserve pnpm/Cargo/runtime caches,
services, databases, credentials and rollback files. Host/app idle gates are
separate; failed reads mean unknown, never idle. Never kill active work to update
or report a scheduled install as complete. Hand over installers from
`~/.bycoda-build/packages/`, never ad-hoc copies. A local update gives no authority
to publish, push or expose signing/authentication state. Honor stop-before-build
requests and report build/installation as unverified.

Use packageManager-pinned pnpm; each worktree owns its dependency links and
outputs. Share the pnpm store, never another checkout's entire node_modules.
Use isolated Host/desktop data and allocated Vite/HMR/Host/CDP ports for parallel
runs. Do not assume changing one port isolates a native run. Keep running native
executables separate from mutable build output. See the managed-workspace
reference for leases, bootstrap and build identity contracts.

On Windows, all shell calls use `exec_command` with `tty=true` and long-running
sessions use `write_stdin`; background helpers/children stay hidden. Do not launch
visible terminal windows unless the owner requests them.

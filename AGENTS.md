# Shared checkout workflow

The owner's normal workflow uses several sessions in the same checkout and branch,
usually `main`. Task and Goal creation defaults to direct execution in the selected
checkout. Do not create a worktree or switch branches unless explicitly requested
or the host has assigned an isolated task workspace.

Keep changes uncommitted for the owner's review. Do not stage, commit, merge, push,
stash, reset, or clean up other sessions' work without explicit authorization.
Inspect the current diff, own only the requested files and changes, and accommodate
edits from other sessions without reverting them. Independent direct tasks may run
concurrently within configured host and goal limits; use dependencies for work
that must happen in order. A direct task marked Done means implementation and its
configured checks finished; the owner still reviews and commits the shared diff.

For explicitly isolated tasks, stay in the host-assigned branch/worktree. The host
owns task commits and approved delivery for that mode. Explicit task instructions
and the owner's selected execution mode take precedence over these defaults.

# Repository file placement

Read `.artifact` before creating, moving, or generating files. Follow its maintained
source/documentation locations and keep task plans, TODOs, research, logs, screenshots,
and one-time helpers in the appropriate ignored `temp/` subdirectory. Preserve useful
retired files in `temp/archive/`; do not scatter agent outputs in the root or product
documentation. Update dependent paths when moving maintained files and run
`node scripts/checks/check-repository-hygiene.mjs` before committing.

# Shared UI and component reuse

For UI work, read `docs/reference/arc-ui.md` and inspect the relevant shared
components before editing. The application's design is compact, minimal and modern;
use Arc through bycoda's existing adapters and theme, not as a separate visual system.

- Search `src/shared/ui/`, the existing settings controls, and the affected feature
  for an existing component or interaction before writing another one. Reuse the
  existing component first; extend its shared API when the missing capability is
  reusable. Create a new shared component only for a concrete unmet requirement.
- Standard application actions must use `src/shared/ui/Button.tsx` or a wrapper
  that delegates to it. Do not introduce screen-specific button styling or new
  visual-only `IconButton`, `ToolbarButton`, `CardAction`, or similar duplicates.
  Keep color, size, shape, focus, disabled and loading presentation centralized.
- Prefer existing `TextField`, `TextareaField`, `SearchableSelect`, settings
  controls, and other shared Arc adapters over raw styled form controls or direct
  registry imports. Registry source belongs under `src/shared/ui/arc/`; application
  consumers use the bycoda adapters. Preserve their native props and ref contracts.
- Native elements are valid inside shared primitives and specialized composites
  when required for correct semantics or events. Tabs, tree rows, menu items,
  window controls and drag targets must retain their keyboard, selection, focus,
  drag and native-window behavior. Route reusable presentation through the shared
  layer; do not replace these controls mechanically with animated action buttons.
- Reuse `Popover`, `Modal`, `overlay.ts` and native popup routing for floating
  surfaces. Do not add another overlay stack, focus trap, Escape handler framework,
  or dialog/menu library to solve an already supported interaction.
- Use existing appearance and motion tokens, shared icons and scoped
  `.bycoda-arc` roles. Do not add parallel palettes, hardcoded control styles,
  global Arc foundation imports, or per-screen copies of the design system.
- Use shared semantic color tokens directly in all application UI, including CSS,
  Tailwind classes and inline styles. Do not write literal hex/RGB/HSL/OKLCH or
  named colors, arbitrary color utilities, or feature-local `color-mix()`, opacity
  or gradient recipes to invent new surface, text, border or interaction colors.
  Use `var(--ui-surface)` for standard panel/card surfaces and the existing shared
  tokens for raised, hover, pressed, selected, text, border and status roles.
  If a new color role is genuinely required, define it once in the owning shared
  theme files under `src/styles/` (`palette.css`, `index.css`, `bycoda.css` or
  `arc.css`, according to the existing ownership), support light/dark and custom
  themes, and consume that token everywhere. Keep color mixing in that shared
  layer; preserve the established neutral hue of surfaces. These project rules
  take precedence over generic skill examples recommending local color recipes.
- Keep headers and action rows compact. Put collection filters and advanced
  options in icon-triggered popovers; indicate active filters on the trigger and
  provide reset inside the popover. Frequent actions stay directly accessible;
  secondary actions belong in an overflow menu. Icons need accessible names and
  tooltips; hover must not be the only way to discover or operate an action.
- Remove repetitive instructions, descriptions and decorative cards. Put optional
  help behind an information control and long supporting details behind disclosure.
  Keep necessary labels, errors, operation state, approval requirements and recovery
  actions visible. Compactness must not remove fields, data, functionality or drafts.
- Preserve existing state ownership, persistence, validation, async callbacks and
  permission gates. A UI refactor does not authorize host/API changes or new send,
  delete, merge or publishing behavior. Loading controls must prevent duplicate actions.
- Changes to shared controls must be checked against representative existing
  consumers, including keyboard operation, narrow layouts, both themes and reduced
  motion. Run focused checks appropriate to the change; do not add implementation-
  mirroring tests or impose an unrelated full-suite/release gate on documentation work.

Existing legacy native controls are not proof that a new duplicate is appropriate.
Migrate them within the requested scope; do not expand a local task into an unsolicited
application-wide rewrite. See the reuse decision rules in `docs/reference/arc-ui.md`.

# bycoda local app/host updates

For local Windows PC and MacBook build/install work, read `docs/local-update.md` and use `scripts/update-local.ps1` as the shared coordinator. Do not recreate ad-hoc build folders, SSH build commands, service swaps, or installer helpers. Use `-Plan` to review the selected machines/options and `-InstallOnly` to reuse this pipeline's already-built package.

The coordinator freezes source once, builds both machines in parallel, and records per-stage logs/timings. Keep its persistent pnpm/Cargo/runtime caches. Use the default local mode for local installs; `-Release` is the explicit full-optimization option. Do not repeatedly build to chase edits from another session.

Host and app idle gates are separate. Never treat a failed database read as zero active sessions, kill active work to speed an update, or claim that a scheduled install is completed. Read `-Status` and the recorded artifacts before reporting success. Keep existing host services, databases, credentials, and rollback files intact. Do not expose auth state/signing keys or infer public-release/commit/push authority from a local update request.

Every build is archived in `~/.bycoda-build/packages/` as `bycoda_<version>_<YYYY-MM-DD>_...`;
hand users installers from that folder, never from ad-hoc copies or Cargo targets.

Honor requests to stop before building: validate the scripts/tests/plan and report that real build/installation remains unverified. On Windows, all shell tool calls use `tty=true`; helpers and child commands stay hidden.

Use the packageManager-pinned pnpm 12 version. Never run npm ci for local updates. Reuse existing node_modules unless package.json changed; missing node_modules requires an initial pnpm install. ForceBuild does not force dependency installation.

# File placement and agent outputs

Read the root `.artifact` policy before creating, moving, or generating any file. It lists where maintained source/docs live and where local agent outputs go.

Agent outputs (plans, TODO lists, audit reports, research notes, one-time scripts, check logs, screenshots) are never committed. Put them under the ignored `temp/` tree using a short task ID such as `2026-10-09-code-audit`:

- `temp/local/<task-id>/` for plans, TODOs, research, scratch data, and a short `README.md` describing purpose, origin, and reuse limits.
- `temp/verification/<task-id>/` for tsc/vitest/cargo logs, benchmark results, and visual review captures.

Do not write such files into `docs/`, the source tree, or the repository root, even if a legacy `.gitignore` pattern would hide them. Confirm with `git check-ignore <path>` and never use `git add -f`. Run `node scripts/checks/check-repository-hygiene.mjs` before committing.

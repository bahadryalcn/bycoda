---
name: feature-projects
description: "Change the project rail, groups, project actions and workspace navigation while keeping project identity, execution cwd, drafts and lifecycle permission gates distinct."
---

# Project navigation changes

## When and scope

Use for project rail/pickers, groups, add/rename/remove/archive, remote project navigation and project backgrounds. Conversation list behavior, execution-workspace policy and saved Appearance settings have separate owners.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding
directory. Follow current imports and callers; this map is not a completeness claim.

- `src/app/shell/ProjectRail.tsx`, `Sidebar.tsx`, `useProjectMenu.tsx`: rail, compact flyouts and shell composition.
- `src/features/projects/`: project models, pickers, search, naming and removal dialogs.
- `src/features/projects/model/contribute*.ts`, `ui/ContributePrompt.tsx`: the contribute invitation (local use counters) and the clone-and-open flow; it opens the clone through the `OPEN_PROJECT_PATH_EVENT` handled in `useProjectOpen`.
- `src/features/connections/`: remote ownership and machine selection.
- `host/domains/projects/`, `src-tauri/src/`: follow project directory/browse/create/open and native file/lock gates.

## Preserve

- Mounted rail snapshots observe cross-window project and tab-group appearance storage keys, including removal/reset. Reuse unchanged collection identities while refreshing labels, colors and mascots.
- Project identity, selected workspace and actual execution directory are different. Preserve worktree/remote identity, full paths and duplicate-name context.
- Retain groups, ordering/pinning, selection, drafts, keyboard/context menus, drag/drop and compact/wide navigation capabilities.
- Pins belong only to ungrouped projects. Groups and linked workspaces have no pin action; a grouped project is never pinned and its old pin is pruned.
- Remove/archive/delete/open are distinct operations with their own dirty/busy/count/confirmation/lock gates. UI filtering grants no new operation scope.
- Compact flyout search filters that list without a second competing picker; keep per-project actions reachable.
- A working project row (`data-project-working`) shows a translucent active tint with a light sweep (`projectRailRow.css`, `--ui-working-row-*` in `src/styles/index.css`) above custom grounds and state fills, below content. Reduced motion and `data-performance-no-shimmer` keep the static tint; the spinner, tooltip and accessible name still say "Working".
- Project identity icon precedence: chosen logo, then a picked mascot, then the logo the local project ships (detected natively and copied into the app logo directory), then the hashed mascot. The project menu edits only the chosen logo.
- Project background overrides, global fallback and separate removal/cancellation/native asset validation retain their owners. A preview is not saved-state proof.

## Workflow

1. Identify project versus workspace/remote action target and all rail/picker/dialog callers.
2. Trace mutations through existing project/native/Host operation owners; preserve draft and permission state when reorganizing UI.
3. Exercise duplicate/long names, groups, compact flyouts, remote failure and cancelled/blocked removal; check sidebar consumers for shared changes.

## Focused checks

For shell identity/search changes, run `pnpm exec vitest run src/app/shell/SidebarRename.test.ts src/features/projects/ui/ProjectSearch.test.ts` plus affected project action/model tests.
Inspect compact/wide rail, keyboard context actions, full-path identity, hidden/locked projects and removal recovery using disposable data. Validate shared operation contracts at their Host/Native boundary when changed.

## Read when needed

- [Owner decisions](references/decisions.md) for group pinning and move toggles.

- [Workbench navigation](../../../docs/guides/workbench.md) for rail behavior.
- [Managed workspaces](../feature-managed-workspaces/SKILL.md), [Sidebar](../feature-sessions-sidebar/SKILL.md), [Archive](../feature-archive/SKILL.md) for their operation contracts.
- [Appearance](../feature-appearance/SKILL.md) and [Privacy](../feature-privacy-security/SKILL.md) when changing project background/visibility settings.

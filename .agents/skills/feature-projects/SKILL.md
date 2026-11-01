---
name: feature-projects
description: Projects inventory for project rail, groups, folder selection, rename/remove/archive, quick actions, logos, remote projects and workspace navigation.
---

# Projects

## V2 2026-10-30: compact Git mark and identities (uncommitted)

- Each project row is its own container (`data-project-row`, `src/app/shell/projectRailRow.css`); it shows
  `+a -d` when the row has room (`projectGitDetailBucket`, `src/features/projects/ui/projectGitChange.ts`),
  otherwise one Changes icon with the changed-file count, icon only below 160 px. File counts and line counts
  are never merged; binary/untracked-only changes now show; missing or failed data shows no mark (the hook
  does not distinguish loading from failure). Full numbers in the row's accessible name and tooltip.
- Same-named projects show their parent folder (`projectIdentity.ts`, `duplicateProjectNames`); names
  truncate with priority over the mark. Flyout rows keep `focusHint` off because the shared Button focus
  tooltip breaks focus return in `SidebarRename.test.ts`.
- Evidence: fixture `tests/browser/project-rail-git.*` (screenshots in `temp/verification/v2-003/`), unit
  tests `projectGitChange`, `projectIdentity`, `ProjectRailGitChange`. Not verified: remote row with Git
  stats, real Sidebar popover, density variants.

## H4 rail/menu source delivery, 2026-10-28

ProjectRail uses shared ActionHost/InlineAction for project/group controls.
Workspace has an accessible icon; project diff counts, group dirty counts and
link warnings remain visible independently of contextual actions. Existing
narrow rail, right-click menus, project identity, locks and saved appearance are
preserved. Remote menu Reconnect/Edit actions retain their IDs under Machine.
Uncommitted baseline `c03fa98d4819494a53ebfa61ff74320105bd05fc`; full checklist:
`temp/local/2026-10-28-h4-workbench/handoff.json`. Test edilmedi under nightly
RULES.md; source delivery does not prove installed/native acceptance.

Open and organize local/remote project identities while keeping their execution workspaces and saved data intact. Keywords: project rail, projects, group, folder, recents, archive, remove, rename, logos, mascot, background, quick actions, remote, workspace navigation.

Inventory inspected on 2026-10-26 at contracts baseline `f26ac112404e326478adb687c23ca9cc032acfef`. Paths are repository-relative. Search again and inspect recent Git history before editing. This card is not a live concurrency lock: check Host feature claims and session/workspace ownership across worktrees. `docs/reference/managed-workspaces.md` defines intended contracts; runtime support must be verified separately.

## Surface inventory

### All project UI components

- `src/features/projects/ui/AdditionalDirsDialog.tsx`
- `src/features/projects/ui/CwdPicker.tsx`
- `src/features/projects/ui/ExternalEditorIcon.tsx`
- `src/features/projects/ui/FolderPicker.tsx`
- `src/features/projects/ui/GroupFetchPopover.tsx`
- `src/features/projects/ui/GroupGitPopover.tsx`
- `src/features/projects/ui/ProjectActionDialog.tsx`
- `src/features/projects/ui/ProjectBackgroundDialog.tsx`
- `src/features/projects/ui/ProjectIconPicker.tsx`
- `src/features/projects/ui/ProjectLogoIcon.tsx`
- `src/features/projects/ui/ProjectMascot.tsx`
- `src/features/projects/ui/ProjectMultiSelect.tsx`
- `src/features/projects/ui/ProjectNameConflictDialog.tsx`
- `src/features/projects/ui/ProjectQuickActions.tsx`
- `src/features/projects/ui/ProjectSearch.tsx`
- `src/features/projects/ui/RailBackgroundControls.tsx`
- `src/features/projects/ui/RemoveProjectDialog.tsx`
- `src/features/projects/ui/RenameProjectFolderDialog.tsx`
- `src/features/projects/ui/SearchableProjectPicker.tsx`
- `src/features/projects/ui/openFolderPicker.tsx`

### Shell, state and app wiring

- `src/app/shell/ProjectRail.tsx`
- `src/app/shell/RailAction.tsx`
- `src/app/shell/Sidebar.tsx`
- `src/app/shell/useProjectMenu.tsx`
- `src/app/shell/useRailSections.tsx`
- `src/app/workspace/bridges/useRemoteRailProjects.ts`
- `src/app/workspace/lifecycle/useProjectLocationSeeding.ts`
- `src/app/workspace/lifecycle/useProjectLockRedirect.ts`
- `src/app/workspace/lifecycle/useProjectNavigationListeners.ts`
- `src/app/workspace/navigation/useRailNavigation.ts`
- `src/app/workspace/projects/useProjectImport.ts`
- `src/app/workspace/projects/useProjectLocation.ts`
- `src/app/workspace/projects/useProjectOpen.ts`
- `src/app/workspace/projects/useProjectRemoval.ts`
- `src/app/workspace/projects/useWorkspaceDirectoryActions.ts`
- `src/app/workspace/projects/useWorktreeRemoval.ts`
- `src/app/workspace/projects/useWorktreeSelection.ts`
- `src/app/workspace/state/useProjectReturnMemory.ts`
- `src/app/workspace/state/useProjectState.ts`
- `src/features/connections/model/remoteProjects.ts`
- `src/features/projects/hooks/useLinkedWorkspaceGroups.ts`
- `src/features/projects/hooks/useTabGroupLogos.ts`
- `src/features/quick-composer/ui/QuickProjectIcon.tsx`

All persisted project identity, organization, recents, location, rename, selection/return, actions/terminal, background/logo/mascot, linked-workspace and code-workspace logic is maintained under `src/features/projects/model/`. It includes mobile-facing directory/logo data adapters, not mobile screens.

### Host RPCs/tools and native modules

`host/server.ts` dispatches `projects.list`, `projects.directory`, `projects.browse`, `projects.createDirectory`, `projects.open`, and `projects.organization.read/patch/status` (three methods under `projects.organization.`). Organization calls relay to desktop `organization.read/patch/status`, preserving revision and live-state authority. Project-scope tools in `host/conversation-tools.ts` and `host/conversation-app-read.ts` read app context; they do not authorize destructive filesystem changes. Native commands include folder browsing/filesystem operations, `save_project_logo`, `remove_project_logo`, `forget_logo_file`, `list_external_editors` and `open_in_external_editor`.

- `host/conversation-app-read.ts`
- `host/conversation-tools.ts`
- `host/desktopSessions.ts`
- `host/server.ts`
- `host/store.ts`
- `host/workspace-commands.ts`
- `host/workspace.ts`
- `src-tauri/src/external_editor.rs`
- `src-tauri/src/fs.rs`
- `src-tauri/src/project_logo.rs`
- `src-tauri/src/remote_folder_access.rs`
- `src-tauri/src/remote_folder_access/os_adapter.rs`
- `src-tauri/src/remote_folder_access/protocol.rs`
- `src/features/projects/model/mobileProjectDirectory.ts`
- `src/features/projects/model/mobileProjectLogos.ts`
- `src/features/projects/model/projectOrganizationControl.ts`
- `src/platform/tauri/fs.ts`

### Locales

`src/shared/i18n/locales/` uses sentence keys rather than a projects dot-prefix. Search key families `Projects`, `Projects and groups`, `Projects stay in the group`, `Projects will become ungrouped`, `Projects and saved conversations will be removed. Folders stay on disk.`, `Archived projects`, plus affected ProjectRail/dialog translation calls. Check `src/shared/i18n/en-overrides.json` and `src/shared/i18n/tr-overrides.json`.

### Browser fixtures/specs

- `tests/browser/compact-navigation.css`
- `tests/browser/compact-navigation.html`
- `tests/browser/compact-navigation.playwright.config.ts`
- `tests/browser/compact-navigation.spec.ts`
- `tests/browser/compact-navigation.tsx`
- `tests/browser/compact-navigation.vite.config.ts`
- `tests/browser/group-menu.html`
- `tests/browser/group-menu.spec.ts`
- `tests/browser/group-menu.tsx`
- `tests/browser/playwright.group-menu.config.ts`
- `tests/browser/project-workspace-navigation.html`
- `tests/browser/project-workspace-navigation.spec.ts`
- `tests/browser/project-workspace-navigation.tsx`
- `tests/browser/serve-group-menu.mjs`
- `tests/browser/vite.group-menu.config.ts`
- `tests/browser/workspace-layout.html`
- `tests/browser/workspace-layout.spec.ts`
- `tests/browser/workspace-layout.tsx`

## Behavior to preserve

Project identity is separate from execution cwd. Keep grouping/order, recent/archive state, saved conversations, provider/sidebar settings, tab return/focus, project-scoped terminals, linked workspaces, local/remote authority, external editors and quick actions. Removing a project from the app must respect its stated filesystem preservation contract; renaming must rebase dependent project data and handle collisions. Preserve user logos/backgrounds, async errors/retry and unsaved-draft checks. Never lose persisted project settings during organization changes.

## Acceptance and checks

- Exercise local/remote, recent/archived, grouped/ungrouped, linked workspaces, code-workspace imports, duplicate/long/non-Latin names, missing/renamed folders, multi-select remove/archive, logos/backgrounds and quick actions. Confirm app removal and filesystem deletion remain semantically distinct.
- Run `pnpm vitest run src/features/projects/model/projectData.test.ts src/features/projects/model/projectGroups.test.ts src/features/projects/model/projectLocation.test.ts src/app/workspace/projects/useProjectRemoval.test.ts src/app/shell/ProjectRailWorkspaceNavigation.test.ts`; add relevant organization/rename/action tests when changed.
- For Host/native changes, verify directory browsing, organization revisions and folder/logo/editor operations with isolated fake data; never mutate owner projects to complete a test.
- Exercise relevant fixtures at 1280/800, light/dark, including narrow rail, groups, opened dialogs, long paths and pending/error states. Save and open screenshots under `temp/verification/<id>/`. Compare build status before treating a screenshot as a new defect, and label fixture/native/installed/release acceptance separately.

## Owner decisions

## Privacy Settings dependency, 2026-10-27

Read `.agents/skills/feature-privacy-security/SKILL.md` and
`temp/local/2026-10-27-settings-privacy-audit/` before changing group protection/
hidden recovery.12 audit records/16 families; protection flag differs from current
lock state, visible count excludes saved-hidden groups, ordinary list already
bounded. projectGroups saves return a boolean that protection writers currently
discard; propagate actual write outcomes without bypassing password/privacy/
group-fingerprint checks. Inventory failure must not imply a successful empty
read. Preserve hidden-name/count authorization when password exists, no-password
recovery, temporary/permanent visibility, membership/jobs and before-paint locked
project redirect with retained tabs/agents. No note/project deletion or exploit
was established.68 existing privacy/project tests pass; no group/data/permission/
source/Host/build/install/release operation performed by this audit extension.

## Proposals

No additional product changes are proposed by this inventory.

## Known blockers and evidence limits

This frozen checkout has no mobile source directory. Mobile screen inventory and physical-device acceptance require the mobile source checkout. Source inspection and browser fixture stubs do not prove installed/native/Host behavior. Contract availability does not establish serving Host capability.

## Committed handoff references

Contracts baseline: `f26ac112404e326478adb687c23ca9cc032acfef`; contracts: `docs/reference/managed-workspaces.md`. Add implementation commits, checks, screenshots and build identity when behavior changes; scratch plans are not shipped behavior.

Inventory delivery: `4454ce32` on `bycoda/wt-model/s7` commits this code-backed
card and the worktree-first documentation. This reference establishes inventory
delivery only; product/runtime acceptance remains as described above.

## Settings Archive dependency, 2026-10-27

Current Archive inventory/quote/11 records/15 families:
`.agents/skills/feature-archive/SKILL.md`; register/brief
`temp/local/2026-10-27-settings-archive-audit/`. This does not replace the whole
project-navigation inventory or grant project deletion authority. Preserve folder,
dirty/busy/count/confirmation/lock gates; Restore also opens/selects. Archived
metadata is uncapped and needs truthful read/write/sibling state; old pin/order
restoration is not guaranteed. Delete cleans desktop saved-session/app data, not
Host filesystem.93 related tests pass; repair/installed/native/mobile acceptance
pending, no actual archive/delete performed.

## Appearance/project background dependency, 2026-10-27

`temp/local/2026-10-27-settings-appearance-audit/`, records APP-09/10/11, reviews
global/project image precedence and native replacement. Global blur affects
project images but its Appearance control is gated on a global image; project
preview omits effective blur. Preserve project override/default, cancellation,
native asset validation and separate global/project removal. Repair preview/
scope/decode/partial replacement through current project/native owners; no
real image/project/preferences were operated.153 Appearance-focused tests pass,
not proposed repairs or project/native acceptance. See feature-appearance for
exact source anchors and boundary.

## Host/WS source integration (2026-10-27)

Project directory/browse/createDirectory/open now share the existing projects service and neutral projects.ts DTOs across HTTP/WS. Creation rechecks grant immediately before mkdir; open retains DB transaction authorization. Existing directory/root navigation is preserved; no UI or native picker redesign is implied.

Source only, uncommitted; no build/install/release stamp. Current full checklist and overlapping evidence: feature-host-runtime/SKILL.md and the local IMPLEMENTATION ledger.

## VIS 2026-10-29: flyout search

Delivered in source (uncommitted; unit evidence only):

- The compact Projects flyout filters its own list through `projectFilter` (`ProjectRail.tsx`); the separate project picker was removed from the compact flyout, so there is one search and one list. Per-project actions (including delete) remain on the flyout rows. Covered by `SidebarRename.test.ts`.

## UI standards round 2026-11-01 (uncommitted)

Round reference: owner request "tamam düzeltmelere başla lütfen hepsini" (2026-11-01, owner chat); primitives and rules in `docs/reference/ui-component-catalog.md` and `ui-design-system.md`. Source only, uncommitted on `main`; nothing built or installed.

Projects, folder/cwd pickers and project dialogs (`src/features/projects/**`, `workspaces/**`), from `HANDOFF-w2-tools.md`.

- Done: RemoveProjectDialog on `ConfirmDialog` (consequences, details, count body, `confirmDisabled`, `pendingLabel`); RailBackgroundControls native colour input to swatch Button + `Popover kind="dialog"`; ProjectSearch pill to `Badge count`, `LoadingText`, `InlineError`, `iconOnly` Buttons; FolderPicker shortcut tooltips and `ActionHost` rows; CwdPicker typography/icons/tooltips and the flyout timer on the shared `useHoverIntent`; ProjectActionDialog `TextareaField monospace`; WorkspaceDirectoryRemoval `ModalActions` with filled danger; rename/name-conflict dialogs on `ModalActions inline`.
- Left: two `Popover role="menu"` in CwdPicker (keyboard model on trigger plus search field plus hover flyout; the picker kit has no flyout); `FileTypeIcon size={N}` at `ProjectSearch.tsx`.
- Unverified: no screenshots or native run; the project-delete ConfirmDialog and the nested colour popover are not natively run.

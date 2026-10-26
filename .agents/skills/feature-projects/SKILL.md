---
name: feature-projects
description: Projects inventory for project rail, groups, folder selection, rename/remove/archive, quick actions, logos, remote projects and workspace navigation.
---

# Projects

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

## Proposals

No additional product changes are proposed by this inventory.

## Known blockers and evidence limits

This frozen checkout has no mobile source directory. Mobile screen inventory and physical-device acceptance require the mobile source checkout. Source inspection and browser fixture stubs do not prove installed/native/Host behavior. Contract availability does not establish serving Host capability.

## Committed handoff references

Contracts baseline: `f26ac112404e326478adb687c23ca9cc032acfef`; contracts: `docs/reference/managed-workspaces.md`. Add implementation commits, checks, screenshots and build identity when behavior changes; scratch plans are not shipped behavior.

---
name: feature-sessions-sidebar
description: Sessions list and sidebar inventory for filtering, archive, pinning, rename, deletion, remote sessions, recovery and worktree focus.
---

# Sessions list / sidebar

Find, organize and reopen conversations while preserving execution ownership and project/worktree context. Keywords: sidebar, sessions list, archive, pin, rename, delete, search, pagination, remote, recovery, worktree focus.

Inventory inspected on 2026-10-26 at contracts baseline `f26ac112404e326478adb687c23ca9cc032acfef`. Paths are repository-relative. Re-run searches and inspect recent Git history before editing. This card is an acceptance inventory, not a concurrency lock: check live feature claims and session/workspace ownership across worktrees. `docs/reference/managed-workspaces.md` defines contracts; contract presence does not establish runtime capability.

## Surface inventory

### Desktop and shared entry points

- `src/app/shell/LastSessionsSection.tsx`
- `src/app/shell/RelativeSessionTime.tsx`
- `src/app/shell/SessionRecoveryControl.tsx`
- `src/app/shell/SessionRecoveryPanel.tsx`
- `src/app/shell/Sidebar.module.css`
- `src/app/shell/Sidebar.tsx`
- `src/app/shell/sessionList.css`
- `src/app/shell/sidebarSurfaces.ts`
- `src/app/workspace/derived/useRailSessionLists.ts`
- `src/app/workspace/layout/WorkspaceSidebar.tsx`
- `src/app/workspace/layout/useSidebarActions.ts`
- `src/app/workspace/layout/useSidebarTabSelection.ts`
- `src/features/crews/ui/CrewSessions.tsx`
- `src/features/orchestration/ui/OrchestrationSidebarAgents.tsx`
- `src/features/sessions/ui/DeleteSessionDialog.tsx`
- `src/features/sessions/ui/SessionAgentIdentity.tsx`
- `src/features/sessions/ui/SessionDeletionNotice.tsx`
- `src/features/sessions/ui/SessionDirsPicker.tsx`
- `src/features/sessions/ui/SessionFiltersMenu.tsx`
- `src/features/sessions/ui/SessionFolderPicker.tsx`
- `src/features/sessions/ui/SessionImportDialog.tsx`
- `src/features/sessions/ui/SessionImportHost.tsx`
- `src/features/sessions/ui/SessionsEmpty.tsx`
- `src/features/settings/ui/SessionListSettings.tsx`
- `src/features/source-control/ui/SidebarWorktreeSwitcher.tsx`

### Sidebar cross-feature UI dependencies

- `src/app/shell/GithubStarPrompt.tsx`
- `src/app/shell/ProjectRail.tsx`
- `src/app/shell/RailAction.tsx`
- `src/app/shell/SidebarUpdate.tsx`
- `src/app/shell/TitleBar.tsx`
- `src/app/shell/useProjectMenu.tsx`
- `src/features/connections/ui/RemoteDataStatus.tsx`
- `src/features/connections/ui/RemoteLoadError.tsx`
- `src/features/files/ui/ExplorerMenu.tsx`
- `src/features/files/ui/FileTree.tsx`
- `src/features/sessions/ui/HarnessIcon.tsx`
- `src/features/sessions/ui/LinkSessionWorkItemDialog.tsx`
- `src/features/sessions/ui/LiveAgentsPreview.tsx`
- `src/features/sessions/ui/SessionWorkingStatus.tsx`
- `src/features/sessions/ui/TerminalSpinner.tsx`
- `src/features/settings/ui/WorkspaceFeatureGate.tsx`
- `src/features/social/ui/SocialShortcut.tsx`
- `src/shared/ui/Alert.tsx`
- `src/shared/ui/Badge.tsx`
- `src/shared/ui/Button.tsx`
- `src/shared/ui/ColorPickerPopover.tsx`
- `src/shared/ui/Modal.tsx`
- `src/shared/ui/ParticleText.tsx`
- `src/shared/ui/Popover.tsx`
- `src/shared/ui/SearchInput.tsx`
- `src/shared/ui/TextField.tsx`
- `src/shared/ui/TransientNotice.tsx`
- `src/shared/ui/icons.tsx`

### State, persistence and cross-machine navigation

The full state and persistence implementations live under `src/features/sessions/model/` and `src/features/sessions/data/`. List-specific paths:

- `src/app/workspace/sessions/useTitleTabActions.ts`
- `src/features/connections/model/adoptedSessions.ts`
- `src/features/connections/model/remoteRailSessions.ts`
- `src/features/connections/model/remoteSessionActions.ts`
- `src/features/connections/model/remoteSessionLists.ts`
- `src/features/connections/model/remoteSessionNavigation.ts`
- `src/features/connections/model/remoteSessionState.ts`
- `src/features/sessions/data/sessionHistory.ts`
- `src/features/sessions/data/sessionStore.ts`
- `src/features/sessions/model/confirmSessionDelete.ts`
- `src/features/sessions/model/session.ts`
- `src/features/sessions/model/sessionListDisplay.ts`
- `src/features/sessions/model/sessionStatusOrder.ts`

### Host RPCs/tools and native modules

`host/server.ts` dispatches `sessions.list`, `sessions.update`, `sessions.delete`, `sessions.page`, `sessions.sync`, `sessions.syncChunk`, `sessions.block`, `sessions.get`, `sessions.desktopLive`, `sessions.adopted` and `sessions.runLease`. Conversation tools expose `sessions.list` and `sessions.read` through `host/conversation-tools.ts`; a read is not send/delete authorization.

- `host/conversation-tools.ts`
- `host/desktopSessions.ts`
- `host/inlineSessionSync.ts`
- `host/server.ts`
- `host/session-authority.ts`
- `host/session-tools-relay.ts`
- `host/store.ts`
- `src-tauri/src/session_import.rs`
- `src-tauri/src/session_store.rs`
- `src-tauri/src/session_store/content_search.rs`
- `src-tauri/src/session_store/incremental.rs`
- `src-tauri/src/session_tools_bridge.rs`
- `src-tauri/src/session_transfer.rs`

### Locales

`src/shared/i18n/locales/` uses sentence keys, not a sessions dot-prefix. Search key families `New session`, `Pinned`, `Archive session`, `Archived conversations`, `sessions from {p0}`, and actual Sidebar/SessionFiltersMenu translation calls. Check overrides in `src/shared/i18n/en-overrides.json` and `src/shared/i18n/tr-overrides.json`.

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
- `tests/browser/playwright.session-usability.config.ts`
- `tests/browser/playwright.sessions-composer.config.ts`
- `tests/browser/playwright.sessions.config.ts`
- `tests/browser/project-workspace-navigation.html`
- `tests/browser/project-workspace-navigation.spec.ts`
- `tests/browser/project-workspace-navigation.tsx`
- `tests/browser/serve-session-deletion.mjs`
- `tests/browser/serve-session-recovery.mjs`
- `tests/browser/serve-sessions.mjs`
- `tests/browser/session-deletion.config.ts`
- `tests/browser/session-deletion.html`
- `tests/browser/session-deletion.spec.ts`
- `tests/browser/session-deletion.tsx`
- `tests/browser/session-preview.tsx`
- `tests/browser/session-recovery.html`
- `tests/browser/session-recovery.playwright.config.ts`
- `tests/browser/session-recovery.spec.ts`
- `tests/browser/session-recovery.tsx`
- `tests/browser/session-recovery.vite.config.ts`
- `tests/browser/session-usability.html`
- `tests/browser/session-usability.spec.ts`
- `tests/browser/session-usability.tsx`
- `tests/browser/sessions-streaming.spec.ts`
- `tests/browser/vite.session-deletion.config.ts`
- `tests/browser/vite.session-usability.config.ts`
- `tests/browser/vite.sessions.config.ts`

## Behavior to preserve

Keep archive distinct from permanent deletion, confirmation and local pending/error recovery, pin/sort/filter persistence, pagination, keyboard focus, long titles, unread/working state, remote authority and worktree focus. Disappearing from a filtered list does not stop a run. Failed Host reads do not mean an empty project.

## Acceptance and checks

- Enumerate affected project, last-session, archived, pinned, filtered, crew, orchestration, remote and recovery lists. Exercise zero/one/many, pagination, duplicate and long multilingual titles, running/deleting/error states and keyboard rename.
- Run `pnpm vitest run src/app/shell/SidebarPagination.test.ts src/app/shell/SidebarRename.test.ts src/app/shell/SidebarRemoteSessions.test.ts src/features/sessions/model/sessionListDisplay.test.ts`; add relevant adjacent deletion/store tests for changed contracts.
- Exercise relevant fixtures at 1280 and 800 pixels, light/dark and reduced motion. Save and open screenshots under `temp/verification/<id>/`; inspect menus, focus, clipping and local feedback.
- Changed list/update/delete operations need isolated Host data and real operation checks. Label fixture, native, installed and release proof separately; compare build status before treating an owner screenshot as a new regression.

## Owner decisions

## Proposals

No additional product changes are proposed by this inventory.

## Known blockers and evidence limits

This frozen checkout has no mobile source directory. Mobile screen enumeration and physical-device acceptance require the mobile source checkout; the shared Host/native paths above do not establish mobile proof. This inventory checks source paths, not installed behavior. Live feature claims and build status depend on serving Host capabilities.

## Committed handoff references

Contracts baseline: `f26ac112404e326478adb687c23ca9cc032acfef`; contracts: `docs/reference/managed-workspaces.md`. On behavior changes, add the implementation commit, focused checks, screenshot paths and build identity. Scratch plans are not shipped behavior.

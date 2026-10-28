---
name: feature-sessions-sidebar
description: Sessions list and sidebar inventory for filtering, archive, pinning, rename, deletion, remote sessions, recovery and worktree focus.
---

# Sessions list / sidebar

## H4 sidebar source delivery, 2026-10-28

Sidebar pane/header edges use shared semantic roles, detailed task titles lead
metadata, and folder expansion no longer marks folders selected. Session row,
recent pin and recovery clear actions consume ActionHost/InlineAction; recovery
pending/error keeps its clear action revealed. Shared working indicators own
their color/size. Existing density, drafts, selection, drag and operations retain
their state owners. Uncommitted baseline
`c03fa98d4819494a53ebfa61ff74320105bd05fc`; per-surface checklist and remaining
H1 text-action/long-press dependencies:
`temp/local/2026-10-28-h4-workbench/handoff.json`. Test edilmedi per RULES.md;
native, keyboard and visual acceptance are pending the owner's morning checks.

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

- 2026-10-27, interactive T3 session `064a143a-3f73-4dc2-bad5-2ad397af3d41`:
  "bycodada update ve bu aynı anda çıksın istiyorum sol altta update ettikten sonra kapatmadıysa kalsın."

## Update and repository footer refinement (2026-10-27)

- `src/app/shell/Sidebar.tsx` and `ProjectRail.tsx` compose the repository link,
  dismiss action and available-update icon through `SidebarUpdateFooter`.
  Narrow project rails retain their update entry point.
- `src/shared/ui/ButtonGroup.tsx` supplies the joined action surface; child
  presentation remains in `Button.module.css`. Hover and press affect one
  surface; click targets, keyboard focus, tooltips and async state stay separate.
  `GithubStarPrompt` and `UpdateRailCard` consume this shared composition.
- Repository dismissal is scoped to the bundled app version. The next version
  reveals it again; closing it leaves an available-update icon usable.
- `src/app/model/updateNotice.ts` retains the installed-update marker across
  startup reads. `useUpdateNotices` removes only the displayed version on explicit
  dismissal; reading release notes keeps the notice, and stale windows cannot
  erase newer installed-update markers.
- Focused model/shell/hook checks and `tests/browser/update-footer.spec.ts`
  exercise the lifecycle and shared controls. Captures belong under
  `temp/verification/2026-10-27-update-footer/` and are browser fixture evidence,
  with native updater and repository-opening operations mocked.
- Delivery is uncommitted in the owner's current `main` checkout at baseline
  `0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`. No package, installation or release
  acceptance is asserted by this refinement.

## Proposals

### 2026-10-27 shell count badge refinement

Delivered narrow presentation sub-scope in the current checkout at
`main @ 0a42b1ab4`: Sessions working count uses the shared small, subtle accent
count badge. Shared count geometry is compact independently of label badges;
accent consumes the existing user/theme tone roles. Local/Host count aggregation,
accessible labels and live announcements remain owned by the existing Sidebar.
Expanded and compact recovery use the same count presentation. Source owners:
`src/app/shell/Sidebar.tsx`, `SessionRecoveryControl.tsx` and
`src/shared/ui/arc/badge/badge.{tsx,module.css}`.

Owner request, 2026-10-27, conversation `603ec448-f6c3-44dc-8e51-46c32b7e4ab1`:
"bu büyüklükte badgeler var accent color a filan hiç ymuyorlar kendi renkleri filan var sanırım bunların düzeltilmesi gerkeiyot".
Focused unit/type and browser evidence is recorded under
`temp/verification/2026-10-27-badges/`. Browser fixtures do not establish installed
app acceptance. Build status reports source inclusion unknown. Conversation tools
expose no live feature-claims action; available sessions and Git worktrees were
inspected, without claiming a cross-machine feature reservation. Delivery remains
uncommitted; no build/install/release is included in this sub-scope.

No additional product changes are proposed by this inventory.

## Known blockers and evidence limits

This frozen checkout has no mobile source directory. Mobile screen enumeration and physical-device acceptance require the mobile source checkout; the shared Host/native paths above do not establish mobile proof. This inventory checks source paths, not installed behavior. Live feature claims and build status depend on serving Host capabilities.

## Committed handoff references

Contracts baseline: `f26ac112404e326478adb687c23ca9cc032acfef`; contracts: `docs/reference/managed-workspaces.md`. On behavior changes, add the implementation commit, focused checks, screenshot paths and build identity. Scratch plans are not shipped behavior.

Inventory delivery: `4454ce32` on `bycoda/wt-model/s7` commits this code-backed
card and the worktree-first documentation. This reference establishes inventory
delivery only; product/runtime acceptance remains as described above.

## Settings Archive dependency, 2026-10-27

Current scoped inventory/quote/11 records/15 families:
`.agents/skills/feature-archive/SKILL.md`; register/brief:
`temp/local/2026-10-27-settings-archive-audit/`. True showArchived selects archive-
only, not active-plus-archived. Preserve provider/time/status filters, current-
project history/read state and open/unarchive/delete distinctions. False result
cannot mean Deleted. Pending/dedupe/drafts/dirty/stop/provider-release/cleanup/
owner/privacy gates remain.93 related tests pass; no new source/record mutation
or changed product/native/installed/mobile acceptance delivered.

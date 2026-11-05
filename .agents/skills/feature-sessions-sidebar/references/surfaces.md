# Session list source map

All source paths are repository-relative. Follow imports for secondary controls.

Session appearance: `src/app/shell/sessionProjectAppearanceStore.ts` shares one
snapshot/subscription across cards. Keep storage reads independent of card count,
refreshing project/logo/sibling changes with storage-failure and server fallbacks.

Native list projection: `session_list_summaries` in `src-tauri/src/session_store.rs`
stores interruption, provider history, activity and management. Full, incremental
and rewind writes update it transactionally; triggers invalidate older writers.
Keep covering indexes and read-only fallback for absent projections/older Host schemas.
Backfill resumes per row without overwriting newer writes; first upgrade creates indexes.

Working preview: `src/features/sessions/ui/LiveAgentsPreview.tsx` is mounted by
`src/app/shell/Sidebar.tsx` and `ProjectRail.tsx`. Project-local callers pass the
open project; Last Sessions omits it. The full header counts precede project-row
summarization and paging. `CompactLiveAgents` in `ProjectRail.tsx` retains its
compact navigation.

| Surface                            | Starting points                                                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full and compact conversation rows | `src/app/shell/Sidebar.tsx`, `src/app/shell/sessionList.css`, `src/app/shell/LastSessionsSection.tsx`                                                                                         |
| Titles and tab identity            | `src/app/workspace/sessions/useTitleTabActions.ts`                                                                                                                                            |
| Collection and status semantics    | `src/features/sessions/model/sessionListDisplay.ts`, `sessionStatusOrder.ts`, `session.ts` in that directory                                                                                  |
| Durable history and deletion       | `src/features/sessions/data/sessionHistory.ts`, `sessionStore.ts`; `src/features/sessions/model/confirmSessionDelete.ts`                                                                      |
| Unsent composer presence           | Search `useUnsentComposerDraft` and `subscribeComposerDraftPresence` in `src/`; preserve mounted and restored draft ownership                                                                 |
| Repository/update footer           | Search `SidebarUpdateFooter` in `src/app/shell/`; `src/app/model/updateNotice.ts`, `src/app/workspace/surfaces/useUpdateNotices.ts` and adjacent tests; `tests/browser/update-footer.spec.ts` |
| Remote lists/navigation            | `src/features/connections/model/remoteRailSessions.ts`, `remoteSessionLists.ts`, `remoteSessionNavigation.ts`, `remoteSessionActions.ts`, `adoptedSessions.ts` in that directory              |
| Operation boundaries               | Follow actual list callers to Host/native dispatch; use session-recovery, archive and managed-workspaces contracts for their operations                                                       |
| Focused checks                     | `src/features/sessions/model/draftCache.test.ts`; search current `tests/browser/` compact-navigation and project-workspace-navigation scenarios                                               |

Localization uses actual `t()` call families in the shell and the existing catalogs
under `src/shared/i18n/`. Do not assume a new sidebar translation namespace.
Mobile source is present under `mobile/` with independent repository ownership;
desktop list checks do not establish mobile or physical-device acceptance.

Interruption projection: `src/features/sessions/model/inFlight.ts` owns the latest
turn marker; `src/features/sessions/data/sessionHistory.ts` and model modules
`recentSessions.ts`/`globalRecentSessions.ts` preserve it through lists.
`src/app/model/appLifecycle.ts` uses the activity-preserving session write for
quit/recovery. Native `src-tauri/src/session_store.rs` stores `last_activity_at`
separately from the update/conflict stamp and orders/cuts off list queries by
activity. Host `host/desktop/desktopSessions.ts` retains interruption and activity in its
desktop projection. Existing pre-migration activity falls back to its stored
update timestamp; do not claim reconstruction of older poisoned timestamps.
Remote projections in `src/features/connections/model/remoteRailSessions.ts`,
`remoteSessionLists.ts` and `remotePageCache.ts` preserve status/activity through
fresh lists, deltas and cached pages. Keep optional activity metadata in
`src/shared/model/host-contracts/session-reads.ts` and regenerate its manifest
after schema changes.

Provider-history projection: `src/features/sessions/model/sessionProviderHistory.ts`,
`src-tauri/src/session_store/provider_history.rs`, `host/store.ts`,
`host/desktop/desktopSessions.ts`; preserve optional summary metadata in remote protocol mappings.
Project identity: `src/app/shell/useSessionProjectAppearance.tsx` reuses rail appearance
resolvers and ActionHost ground. Layout/interaction fixtures: `tests/browser/session-row-layout.spec.ts`.

Global Last Sessions workspace: `src/features/sessions/hooks/useGlobalRecentSessions.ts`
and `src/features/sessions/model/globalRecentSessions.ts` combine the rolling seven-day
read with allowed-project visibility and live summaries. `session_list_recent_since`
in `src-tauri/src/session_store.rs` retains the existing compact rail query separately.
`src/app/App.tsx` owns list mode and exact-project navigation;
`src/app/workspace/tabs/useNewSessionActions.ts` resolves adopted remote identities.
Project-local rows remain neutral; only the global list applies saved project appearance.
The global time menu is limited to Today and Last 7 days because its source window is seven days.

Global New session project choice: `src/features/projects/ui/NewSessionProjectDialog.tsx`
composes the shared modal/picker primitives. `Sidebar.tsx` mounts it for the header
action or a new `newListedSessionRequest`; handled requests must not replay on remount.
`App.tsx` routes generic New commands through the selector while Last Sessions is open.
`src/app/workspace/tabs/useNewSessionActions.ts` creates directly for the explicitly
chosen project and saved checkout; the App callback rechecks current visibility/locks.

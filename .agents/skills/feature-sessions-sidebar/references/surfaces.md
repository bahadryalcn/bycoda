# Session list source map

All source paths are repository-relative. Follow imports for secondary controls.

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

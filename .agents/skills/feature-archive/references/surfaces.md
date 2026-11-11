# Archive surfaces

All code paths are repository-relative.

| Area                   | Owner                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page/search/reveal     | `src/features/settings/ui/ArchiveSettings.tsx`, `SettingsView.tsx`, `SettingsSearch.tsx`; `src/features/settings/model/settings.ts`                           |
| Project archive state  | `src/features/projects/model/recents.ts`, `projectData.ts`; `src/features/workspace/model/tabGroups.ts`                                                       |
| Project removal        | `src/app/workspace/projects/useProjectRemoval.ts`; `src/features/projects/ui/RemoveProjectDialog.tsx`                                                         |
| Sidebar/archive filter | `src/features/sessions/model/sessionFilters.ts`; `src/features/sessions/data/sessionHistory.ts`; `src/app/shell/Sidebar.tsx`                                  |
| History/load/open      | `src/app/workspace/sessions/useHistoryRefresh.ts`, `useOpenSessionActions.ts`; `src/features/sessions/data/sessionStore.ts`                                   |
| Session archive/delete | `src/app/workspace/sessions/useHistorySessionArchive.ts`, `useHistorySessionDelete.ts`; `src/features/sessions/model/archiveShortcut.ts`, `sessionRemoval.ts` |
| Confirmation/access    | `src/shared/ui/ConfirmMorph.tsx`; `src/app/workspace/lifecycle/useProjectLockRedirect.ts`; `src/features/group-lock/model/lockState.ts`                       |

## Data and routing

- Project archive storage uses `bycoda.archivedProjects`, normalized paths and `archivedAt`; session dates remain activity dates. Verify the storage owner before extending schema.
- Native `session_list_by_project`, `session_set_archived`, `session_delete` route through `src-tauri/src/session_store.rs` and registration in `src-tauri/src/lib.rs`. Preserve adopted/remote session ownership and existing eligible-summary exclusions.
- `projects.organization.read/patch/status` are organization operations, not general filesystem-delete authority. Follow `src/features/projects/model/mobileProjectDirectory.ts` and the actual Host dispatcher when crossing this boundary.
- Mobile archive-related consumers include `mobile/src/features/workspace/session-settings.tsx` and `project-directory.ts`; Host `sessions.update`/directory filtering is not proof of a full desktop Archive-management equivalent.
- Search reveal IDs `archived-projects`, `archived-conversations`, `show-archived`; localize count, date, folder and dirty-file consequences.

## Focused checks

Inspect colocated tests for recents/projectData, `RemoveProjectDialog`, `useProjectRemoval`, sessionFilters/sessionHistory, archiveShortcut/sessionRemoval and ConfirmMorph. Relevant browser scenarios live in `tests/browser/settings/settings-subviews.e2e.ts`, `settings-layout.e2e.ts`, `settings-organization.e2e.ts` under the Settings fixture/config.

Cover zero/one/large collections, full-search reachability, scope changes, sibling writes, unavailable reads, duplicate row actions, cancel/false/reject/partial outcomes, relock races and folder-preserving removal. Use fake repositories/stores for destructive cases; runtime ownership checks require isolated native/Host evidence.

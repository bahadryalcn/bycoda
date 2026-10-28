---
name: feature-archive
description: "Settings Archive inventory for archived projects/current-project conversations, bounded searchable lists, sidebar active/archive mode, read/storage/sibling state, open/restore/unarchive/delete outcomes, locking and native/Host/mobile authority. Read before Archive redesign."
---

# Archive management

Find/restore archived projects and conversations with clear scope/data state and
precise deletion consequences. Keywords: Archive, Archived projects, Archived in,
archived conversations, show archived, sidebar archive visibility, Restore,
Unarchive, Delete, long list, search, retained data, locks and folders.

## Scope and identity

2026-10-27 T2 audit/design; dirty shared
`main @ 0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`. History inspected:
`cf3944cfb`, `3419af022`, `1459c3ab0`, `d34c7b582`. One light wide owner
capture opened, installed source inclusion UNKNOWN. Two native read-only reviews
plus parent checks:11 records (two V+S,nine S),15 families. No product repair.
Live claim API unavailable; Git/worktree/session context inspected, card is not
a lock. Preserve concurrent staged/dirty work; no index/branch operation.

Register/repair: `temp/local/2026-10-27-settings-archive-audit/AUDIT.md` and
REDESIGN.md. Evidence:
`temp/verification/2026-10-27-settings-archive-audit/EVIDENCE.md`.
Settings/Projects/Sessions/workbench cards and main plan S link this scope.

## Owner decisions

2026-10-27, conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`, exact excerpt
after the inline image reference:

> ARchive ekranı bu kadar byrda neden accordion var mesela ben yine hiç anlamadım. Arşiv listesi uzun olsa aşağıya kadar uzayacak saçma sapan bir ekran tasarımı var burda da.

Audit/simplification requested. No actual archive/restore/delete/preference write,
all-project conversation scope or new network/background policy selected. Layout
and controls in REDESIGN.md are agent proposals, not implemented behavior.

## Surface inventory

15-family ledger in AUDIT.md; search settings/projects/sessions, workspace actions/
history/removal/lock, shared confirmation, native/Host/mobile and browser fixtures.

| Area                    | Source                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI/search               | `src/features/settings/ui/ArchiveSettings.tsx`, `SettingsView.tsx`, `SettingsSearch.tsx`; `src/features/settings/model/settings.ts`                                                          |
| Settings wiring/history | `src/app/workspace/layout/WorkspaceSettingsSurface.tsx`; `src/app/workspace/sessions/useHistoryRefresh.ts`; `src/features/sessions/data/sessionStore.ts`                                     |
| Project metadata/labels | `src/features/projects/model/recents.ts`; `src/features/workspace/model/tabGroups.ts`; bycoda.archivedProjects/path normalization/archivedAt                                                 |
| Project lifecycle       | `src/app/workspace/projects/useProjectRemoval.ts`; `src/features/projects/ui/RemoveProjectDialog.tsx`; `src/features/projects/model/projectData.ts`                                          |
| Sidebar mode            | `src/features/sessions/model/sessionFilters.ts`; `src/features/sessions/data/sessionHistory.ts`; `src/app/shell/Sidebar.tsx`                                                                 |
| Session open            | `src/app/workspace/actions/useMiscWorkspaceActions.ts`; `src/app/workspace/sessions/useOpenSessionActions.ts`                                                                                |
| Session archive/removal | `src/app/workspace/sessions/useHistorySessionArchive.ts`, `useHistorySessionDelete.ts`; `src/features/sessions/model/archiveShortcut.ts`, `sessionRemoval.ts`                                |
| Confirmation/privacy    | `src/shared/ui/ConfirmMorph.tsx`; `src/shared/ui/arc/confirm-morph/confirm-morph.tsx`; `src/app/workspace/lifecycle/useProjectLockRedirect.ts`; `src/features/group-lock/model/lockState.ts` |
| Native/organization     | `src-tauri/src/session_store.rs`, `lib.rs`; `src/features/projects/model/mobileProjectDirectory.ts`                                                                                          |
| Mobile counterpart      | `mobile/src/features/workspace/session-settings.tsx`, `project-directory.ts`; Host-backed session updates are separate from desktop Archive                                                  |

Native commands session_list_by_project/session_set_archived/session_delete back
desktop storage. Project query returns all eligible summaries for cwd, excludes
inbox-ask/orchestration workers and has no LIMIT/cursor. This is not a Host project/
filesystem-delete grant. Preserve adopted/remote session-owner routing. Organization
RPCs projects.organization.read/patch/status are not general archive/delete
authority. Mobile uses separate Host filtering/sessions.update; archived local
projects are excluded from its directory, so Archive-management parity is absent.

Preserve search IDs archived-projects, archived-conversations and show-archived.
Sentence-key locale families: Archive, Archived projects/in/conversations, Restore,
Unarchive, Delete, sidebar archive visibility, empty/loading/error/retry and count/
folder/dirty-file consequences. Dates must use actual meaning and locale.

## Findings and preservation

Only the sidebar mode is inside defaultOpen=false AdvancedSettings, not the list.
Remove unnecessary single-control structure locally. Actual showArchived true is
archived-only, false active-only; existing alongside-active help is inaccurate.
Keep that filter distinct from record archiving and this page's list. One-time
filter snapshot/full-object save can overwrite changed provider/time/status;
storage failure is swallowed. Preserve legacy key migration and reconcile fields.

Both collections map all loaded rows; archived-project storage has no cap (recent
MAX200 is unrelated). Propose searchable bounded continuous lists/virtualized
rendering at scale with all records accessible. Projects are app-wide authorized
rows; conversations selected-project. Pass history read/loading/error state; project
corrupt/unavailable reads must not look empty. No new cursor or global session
aggregate inferred. Fix project multi-store write outcomes and sibling-window
subscription while retaining recoverable data/selection.

Project Restore also selects/opens it. Archive drops rail order/pins but keeps
saved data; restoring prior pin/order is not an existing promise. Project archivedAt
differs from conversation updatedAt/last activity. No session archive timestamp
should be invented. Open archived session, unarchive and delete remain separate;
opening does not send or clear archive flag.

Delete false can mean cancel/guard/failure, but ConfirmMorph currently treats any
resolved Promise as done. Only verified removal announces Deleted. Unarchive needs
row pending/dedupe/retry. Preserve count/unknown/error/pending/partial recount,
dirty/busy/removing, stop/queue/checkpoint/provider-release and concurrent tab/draft
guards. Project deletion purges desktop conversations/app metadata while preserving
project folder; workspace cleanup retains its own managed authority.

Locked archived projects are filtered; active locked-project redirect preserves
tabs/runs. Separate captured project delete target can survive relock and needs
pruning/revalidation before commit. Do not assert a generic session leak or expose
hidden titles/counts; scope/machine/selection changes retain action ownership.

## Checks and acceptance

93 existing tests/eight files pass once: recents, projectData, RemoveProjectDialog,
useProjectRemoval, sessionFilters, sessionHistory, archiveShortcut, ConfirmMorph.
Static three-file scan[]. These are baseline source/fixture contracts, not repaired
Archive UI/resolved-false/relock/write-error acceptance. Related sessionRemoval,
useOpenSessionActions, Settings surface and mobile-directory tests are inspected/
recommended, not run here. Browser settings fixtures/configs: settings.html,
settings.tsx, settings-subviews.e2e.ts, settings-layout.e2e.ts,
settings-organization.e2e.ts, playwright.settings.config.ts, vite.settings.config.ts
under tests/browser. Diagram review is not actual product1280/800 acceptance.

Repair acceptance: actual light/dark1280/800/narrow, zero/one/large/long-name lists,
scroll/search/focus/reader/zoom/reduced motion; scope/read completeness, sidebar mode/
other filters, corrupt/write/sibling recovery, delete cancel/blocked/failed vs done,
unarchive pending, relock/target changes and existing folder/owner/lifecycle gates.
Isolated native/Host/installed/mobile acceptance separate; update guides when
behavior is implemented. Exact named unverified checks are in EVIDENCE.md.

## Handoff and proposals

Audit/card ready for review, repair pending. Compact scoped collections and a
truthful sidebar mode are proposals. No new bulk delete, remote authority or
background sync inferred. No app source, real archive/open/restore/delete/filter,
Host/native data call, build/install/release, index/branch change or commit.

## H3 Archive Settings implementation, 2026-10-28 (uncommitted)

ArchivePage uses bounded searchable project/conversation collections; all loaded
records remain reachable. The sidebar archive-only preference is direct and
accurately explained, patches the latest filter snapshot and reads back the result.
Project rows reconcile sibling storage events and captured delete targets are
removed/revalidated when no longer authorized. Restore/unarchive actions expose
row pending/errors; a false delete/unarchive result no longer becomes completion.
Shared confirmation and project-removal lifecycle/count/dirty safeguards remain.
Conversation dates remain last activity and include year; scope and reveal IDs stay.

Test edilmedi under the nightly owner rule. History read/error/completeness,
project storage read/transaction outcomes and parent callback-result guarantees
remain concrete owner dependencies. Large rendering/virtualization, lock races,
local/sibling filters, cancellation/failure and themes/1280/800/narrow/keyboard/
density need morning acceptance. See per-ID AR-01..11 handoff:
`temp/local/2026-10-28-settings-pages-a/workspace.json`. No live data mutation,
build/install/release or installed inclusion proof.

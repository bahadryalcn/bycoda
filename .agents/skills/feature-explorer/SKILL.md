---
name: feature-explorer
description: Explorer file tree inventory for root/worktree identity, compact header, create/rename, selection and keyboard, excluded visibility, Git markers, chunked large folders, cache/freshness, context menus, clipboard, drag/drop and local/remote filesystem recovery. Read before changing Explorer layout or file actions.
---

# Explorer and file-tree management

## H4 implementation packet, 2026-10-28

Implementation and per-record review for EXP-01..09 are tracked in
`temp/local/2026-10-28-explorer-content-impl/handoff.json`. The packet consumes
existing shared controls and keeps Sidebar's keyed FileTree/root lifecycle,
native filesystem permissions and cache/large-folder behavior. Prior native
draft-persistence edits in files/data and editor consumers remain independently
owned. Source baseline `4de508deabfdae8fd9a8c4c35ab7c4032b5924e9`, shared `main`;
no new commit is implied. User guide: `docs/guides/explorer-and-file-content.md`.
Test edilmedi: nightly RULES.md defers all suites, fixtures, screenshots and
native/remote operations. Consult the handoff for exact delivered scope, missing
shared contracts and the single final fast typecheck result; no audit closure
or installed acceptance follows from source implementation.

## Purpose and keywords

Keep filesystem context, file reading and operation scope understandable in the
workspace sidebar. Keywords: Explorer, FileTree, root header, Show excluded files,
tree selection, cache, Show more, root drop, filesystem actions. Distinct from
project management, content search, file editor/diff, managed workspace policy
and independent mobile navigation. Layout changes grant no file-operation authority.

## Surface inventory

Inspected2026-10-27, main@d8bf868fae841b8b391ce148487cd7d373ea9762, source0.6.94,
dirty shared checkout. Search roots: src/features/files, src/app/shell,
src/app/workspace/files, src/platform/tauri, src/features/connections, shared UI/
libraries, Host/native filesystem routing and mobile workspace routes.

- Desktop: `src/app/App.tsx` rootLabel/worktree wiring, `src/app/shell/Sidebar.tsx`
  FileTree/root gitRoot/tabs/search/key; `src/features/files/ui/FileTree.tsx`
  FileTree, TreeChildren/TreeNode, NameRow, HeaderIcon, ExplorerSyncStatus.
- Menus: `src/features/files/ui/ExplorerMenu.tsx` compatibility export of
  `src/shared/ui/ContextMenu.tsx` and
  `src/shared/ui/arc/context-menu/native-context-menu.tsx`. Shared Button/TreeRow
  and `src/shared/ui/arc/tree-view/tree-row.tsx` retain native semantics.
- State: `src/features/files/model/fileTree.ts`, treeSelection.ts, fileName.ts;
  root-keyed selected/expanded storage, cache epochs, listing freshness, polling,
  chunk/window membership, operation/clipboard/partial-success state in FileTree.
- Search: `src/features/projects/ui/ProjectSearch.tsx`; shared feature-search card
  owns content search behavior. This is not a filename-filter replacement.
- Preference: `src/features/settings/model/settings.ts` Show excluded files,
  WorkspaceSettings consumer; feature-workspace-settings owns the persisted setting.
- Remote reveal/browse: `src/features/files/ui/useRemoteFolderBrowser.tsx`,
  ChatFolderBrowser.tsx and `src/shared/lib/remoteExplorerPaths.ts` mapped-share
  handling. Do not substitute local reveal for unmapped remote browsing.
- Platform: `src/platform/tauri/fs.ts` path-owned local Tauri or remote runner;
  commands include list_dir/create_path/rename_path/delete_path/copy_path/move_path,
  clipboard file paths/native drag and reveal. Local/remote execution is separate
  from visible tree selection.
- Remote: `src/features/connections/model/remoteCommands.ts` maps one-machine
  paths, rejects mixed-machine transfer and routes workspace.run. `host/server.ts`
  delegates workspace.run to `host/workspace-commands.ts`; handlers retain project/
  worktree containment, collision/self-descendant and expected-hash contracts.
- Native: `src-tauri/src/fs.rs` create/rename/delete/copy/move implementations;
  existing file_access::require and copy-tree validation remain authoritative.
  This audit introduces no new RPC/tool or capability.
- Mobile boundary: `mobile/app/project/[id].tsx` files segment and
  `mobile/src/features/workspace/project-screen.tsx` are independent UI routes.
  Desktop header relocation is not routed there; shared Host contracts remain.
- Copy/locales: t() families New File, New Folder, Collapse All, Search in files,
  Copy Path/Relative Path, File change saved. Refresh failed., Retry, Loading,
  Show more/all, root files and freshness; shared i18n owns translated catalogs.
- Focused assets: FileTree.test.ts, model/fileTree.test.ts, treeSelection.test.ts,
  fileName.test.ts, shared TreeRow.test.ts/ContextMenu.test.ts,
  shared/lib/remoteExplorerPaths.test.ts, ProjectSearch.test.ts,
  ChatFolderBrowser.test.ts, platform/tauri/fs.test.ts,
  connections/model/remoteCommands.test.ts; browser `tests/browser/file-tree.spec.ts`.
  Host workspace-commands.test.ts covers separate backend containment.

The complete16-family checklist and nine records (three V+S/six S) are in
`temp/local/2026-10-27-explorer-audit/AUDIT.md`; repair specification REDESIGN.md.

## Owner decisions

2026-10-27, T3 thread0567326f-aade-4baa-89f3-b44c6256ae9e, exact text surrounding
the inline image:

> explorer kısmıda bu şekilde gözüküyor

> bu ksım yukarı filan alınıp burası daha iyi bir hale getirilebilirdi

No new hidden-file/default/tree engine policy is selected. General workbench
design decisions remain in feature-workbench-design.

## Behavior to preserve

Retain distinct workspace focus, filesystem root/worktree label and execution
identity. Root owns collapse/selection/full cwd/context menu, keyboard and drop
markers inside rootRef; root already sits outside its file-list scroller. Keep
Sidebar gitRoot key, mounted hidden tabs and root/read request guards. Do not
move root DOM out of the event owner without adapting selectors/hit-testing.

Retain exact paths, range anchor, multiselection, Ctrl+A rendered non-root rows,
keyboard/typeahead/Tab focus, preview/pinned opening, editor move/delete callbacks,
root exclusion from cut/duplicate/rename/delete, file/folder/multiple menu gates,
GIT_ACTIONS history/blame support and terminal capability. Preserve filename
validation, inline drafts/errors/cancel, one destructive confirmation for deduped
top-level selection and remaining-only cut retry after partial success.

Preserve native/internal/external drag/drop/clipboard, modifier copy versus move,
self-descendant rejection, attachment drags and cancel/blur/Escape. Keep ignored
styling/Git markers, persisted excluded preference and explicit selection scope.
Cache epochs/eviction/latest guards, offline last listing, bounded refresh/backoff
and hidden-tree pause already exist; do not report them generically missing.
Large folders use threshold300/chunk200 with Show more/all and must-show paths,
not virtualization. Preserve this access and native/menu permission boundaries.

## Checks and visual scenarios

Existing focused source/mock checks and exact results live in
`temp/verification/2026-10-27-explorer-audit/EVIDENCE.md`. Required implementation
checks are separate from159 existing tests/12 suites that passed during audit;
two ChatFolderBrowser act-warning groups are retained. Required implementation
acceptance: merged root keyboard/context/drop/freshness/search contracts; excluded
mode plus hidden selection; clipboard API+fallback failure; success then refresh
failure/remaining-only recovery; root identity, deep/non-Latin/long names,301+
entries, empty/loading/error/stale, short panes, all rail modes and themes.
Capture actual app1280/800 light/dark and narrow sidebar, inspect keyboard/reader,
reduced motion and native/remote behavior with disposable data.

## Known blockers and evidence limits

Audit only; no application implementation. Actual changed UI/native/reader/live
remote filesystem/installed checks are unverified because no isolated app/live
run occurred. Owner screenshot build inclusion UNKNOWN; no source receipt.
Feature-claim API not exposed; agent/worktree state consulted, no reservation
acquired. Shared Sidebar/Button/settings/filesystem/package/Host work preserved.
Conditional reused-instance mutation completion is not claimed production-reachable:
Sidebar keys FileTree by gitRoot. New source-risk regressions remain for implementer.

## Committed handoff references

No new commit. Audit/specification/static example delivered locally on baseline
main@d8bf868f. Evidence ledger separates current source/mock tests from schematic,
native, installed and released acceptance. No guide behavior changed, no build/
install/release or filesystem action delivered.

## Proposals

Merge root identity/tools into one compact panel header below workspace tabs,
using shared controls and existing menu stack; preserve all16 families. Explain
visibility mode/scope and empty states. Fix local copy/pending/result honesty and
post-mutation refresh recovery. Root tab centering should be addressed through
the owning shared alignment API, without globally changing workspace tabs.

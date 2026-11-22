---
name: feature-source-control
description: "Use when changing Git review, staging, history, diffs and branches. Not for execution worktrees; see feature-managed-workspaces."
---

# Source control changes

Use for the Git panel and shared diff controls. Managed workspace lifecycle/rewind and saved global settings have separate owners. Inbox uses UnifiedDiffView and must be checked when that renderer changes.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding directory. Follow current imports and callers; this map is not a completeness claim.

- `src/features/source-control/ui/`: Git panel, changes, history, branch/worktree/conflict dialogs and UnifiedDiffView.
- `src/features/source-control/model/` and data resources: status, selection, graph/filter/window and operation state.
- `src/features/settings/ui/SourceControlSettings.tsx`: saved Git preferences and generation settings.
- `host/domains/git/`, `src/platform/tauri/`, `src-tauri/src/`: follow exact Git action/command and repository permission owners.

## Preserve

- Host Git watch callbacks classify irrelevant paths before IO and coalesce bounded asynchronous directory checks. Slow/failed metadata remains unknown and conservatively notifies; late callbacks belong to their original watcher generation.
- Diff hover reuses mounted row/action membership between DOM commits; pointer motion must not rescan every row. Refresh membership after virtual-window or comment changes and clear original pointer marks on leave.
- Repository/project, Git review target and execution checkout are distinct. Preserve independent submodule identity and complete paths.
- Native Git status caches have bounded repository count, retained payload and idle lifetime; eviction must re-query without changing status or diff results.
- Submodule discovery streams the Git index with bounded records and a shared deadline; a burst of discoveries (one per checkout) waits for Git stream capacity until that deadline instead of failing; keep staged and conflicted gitlinks, and report incomplete discovery as an error.
- Source-control overviews opt into bounded child-repository discovery with `git_submodules`'s `includeRepositories` flag. Include ignored source repositories; skip directory links and dependency/build outputs. The default remains gitlinks only. A path that vanishes mid-scan (agents deleting files in worktrees, a removed checkout) is skipped, not a failure; a repository-scan size bound (entries, directories, depth, repositories) returns the repositories found so far with `limit` (`git_submodules` with `includeRepositories` returns `{ paths, limit }`, without it the plain path list the mobile client reads; Host and Rust scanners share the bounds) and the UI says the scan was limited; a deadline, a changed directory or other failure preserves the last inventory, never an empty result presented as complete. The deep scan runs once per checkout per app session and on explicit refresh; Git change events and focus refresh only the gitlink list and merge it into the cached inventory.
- History paging continues one `--topo-order` walk with `git_history`'s `skip`; the cache holds one entry per checkout and scope, and a ref change re-reads the loaded depth in one request instead of mixing pages from two ref states.
- Retain staged/unstaged and selected hunk/line scopes, binary/large files, conflict provenance, index changes, drafts and operation recovery.
- Filtering changes visible entries, not All-operation scope; partial staging may show one path twice. Explain exact target/consequence before mutations.
- Commit remains independently available from push; preserve explicit combined variants, amend behavior and upstream-aware Push/Pull/Sync/Publish gates.
- Pull request text generation rejects on provider failure or an unusable reply (`PrGenerationError`, provider text kept out of the UI); the raw commit summary is only the owner's explicit alternate action, never a silent fallback.
- Commit generation keeps explicit cancellation, preserves newer drafts, and lets users review generated text after Git changes. Diff layout keeps shared persisted preference, auto-width behavior and sibling-window synchronization.
- Remote commit/PR generation uses `git.generateText` on the repository Host with its model routing and account profiles. Cancellation dismisses the wait while bounded Host execution settles. Never send remote cwd to desktop providers.
- Keep expected-state/permission checks, confirmation and partial/uncertain result recovery at the actual Git operation boundary; never clear unrelated work to pass checks.

## Workflow

1. Trace the selected repository/checkout and action scope through UI, resource/model and Host/Native dispatcher.
2. Inspect every affected Git consumer and Inbox diff caller; keep preference ownership separate from per-view layout.
3. Exercise staged/unstaged/filter/checkout changes and cancellation/recovery against disposable repositories, then update the corresponding user guidance.

## Focused checks

Run focused Git component/model tests; shared review changes need `pnpm exec vitest run src/features/source-control/ui/UnifiedDiffViewSplit.test.ts src/features/source-control/ui/UnifiedDiffView.markers.test.ts` plus actual Inbox/file consumers. Exercise no/multiple repositories, submodules, partial staging, conflicts, binary/large paths, long history and branch/worktree failures. A CodeMirror fixture cannot prove UnifiedDiffView behavior; destructive checks require disposable repositories.

## References

- [Source control guide](../../../docs/guides/source-control.md) for operation scope and commit/push/diff behavior.
- [Managed workspaces](../feature-managed-workspaces/SKILL.md) for lifecycle and rewind; [GitHub Inbox](../feature-inbox-github/SKILL.md) for exact-head PR review.
- [Markdown](../feature-markdown-preview/SKILL.md) only for shared file-preview/scroll dependencies.

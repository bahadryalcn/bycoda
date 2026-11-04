---
name: feature-source-control
description: "Change Git review, staging, history, diffs, branches/worktrees and recovery while preserving selected-checkout identity, index state and publication/destructive gates."
---

# Source control changes

## When and scope

Use for the Git panel and shared diff controls. Managed workspace lifecycle/rewind and saved global settings have separate owners. Inbox uses UnifiedDiffView and must be checked when that renderer changes.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding
directory. Follow current imports and callers; this map is not a completeness claim.

- `src/features/source-control/ui/`: Git panel, changes, history, branch/worktree/conflict dialogs and UnifiedDiffView.
- `src/features/source-control/model/` and data resources: status, selection, graph/filter/window and operation state.
- `src/features/settings/ui/SourceControlSettings.tsx`: saved Git preferences and generation settings.
- `host/domains/git/`, `src/platform/tauri/`, `src-tauri/src/`: follow exact Git action/command and repository permission owners.

## Preserve

- Diff hover reuses mounted row/action membership between DOM commits; pointer motion must not rescan every row. Refresh membership after virtual-window or comment changes and clear original pointer marks on leave.
- Repository/project, Git review target and execution checkout are distinct. Preserve independent submodule identity and complete paths.
- Native Git status caches have bounded repository count, retained payload and idle lifetime; eviction must re-query without changing status or diff results.
- Submodule discovery streams the Git index with bounded records and a shared deadline; keep staged and conflicted gitlinks, and report incomplete discovery as an error.
- Retain staged/unstaged and selected hunk/line scopes, binary/large files, conflict provenance, index changes, drafts and operation recovery.
- Filtering changes visible entries, not All-operation scope; partial staging may show one path twice. Explain exact target/consequence before mutations.
- Commit remains independently available from push; preserve explicit combined variants, amend behavior and upstream-aware Push/Pull/Sync/Publish gates.
- Generation preserves cancellation and stale draft/index protection. Diff layout keeps shared persisted preference, auto-width behavior and sibling-window synchronization.
- Keep expected-state/permission checks, confirmation and partial/uncertain result recovery at the actual Git operation boundary; never clear unrelated work to pass checks.

## Workflow

1. Trace the selected repository/checkout and action scope through UI, resource/model and Host/Native dispatcher.
2. Inspect every affected Git consumer and Inbox diff caller; keep preference ownership separate from per-view layout.
3. Exercise staged/unstaged/filter/checkout changes and cancellation/recovery against disposable repositories, then update the corresponding user guidance.

## Focused checks

Run focused Git component/model tests; shared review changes need `pnpm exec vitest run src/features/source-control/ui/UnifiedDiffViewSplit.test.ts src/features/source-control/ui/UnifiedDiffView.markers.test.ts` plus actual Inbox/file consumers.
Exercise no/multiple repositories, submodules, partial staging, conflicts, binary/large paths, long history and branch/worktree failures. A CodeMirror fixture cannot prove UnifiedDiffView behavior; destructive checks require disposable repositories.

## Read when needed

- [Source control guide](../../../docs/guides/source-control.md) for operation scope and commit/push/diff behavior.
- [Managed workspaces](../feature-managed-workspaces/SKILL.md) for lifecycle and rewind; [GitHub Inbox](../feature-inbox-github/SKILL.md) for exact-head PR review.
- [Markdown](../feature-markdown-preview/SKILL.md) only for shared file-preview/scroll dependencies.

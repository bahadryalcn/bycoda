---
name: feature-source-control
description: Git panel and source-control inventory for changes, staging, history graph, conflicts, branches, worktrees, stashes and guarded delivery.
---

# Git panel / source control

Inspect and operate on the selected repository and checkout while preserving unrelated work, index state, operation recovery and approval gates. Keywords: git panel, source control, changes, diff, staged, commit, history graph, branch, worktree, conflict, stash, PR, merge, submodule.

Inventory inspected on 2026-10-26 at contracts baseline `f26ac112404e326478adb687c23ca9cc032acfef`. Paths are repository-relative. Search again and inspect recent Git history before editing. This card is not a live concurrency lock: check Host feature claims and session/workspace ownership across worktrees. `docs/reference/managed-workspaces.md` defines intended contracts; runtime support must be verified separately.

## Surface inventory

### All source-control UI components

- `src/features/source-control/ui/BranchManagerDialog.tsx`
- `src/features/source-control/ui/BranchPicker.tsx`
- `src/features/source-control/ui/CheckoutList.tsx`
- `src/features/source-control/ui/CommitDiff.tsx`
- `src/features/source-control/ui/ConflictLayout.tsx`
- `src/features/source-control/ui/ConflictSash.tsx`
- `src/features/source-control/ui/CreateBranchDialog.tsx`
- `src/features/source-control/ui/CreateWorktreeDialog.tsx`
- `src/features/source-control/ui/DeleteWorktreeDialog.tsx`
- `src/features/source-control/ui/DiffCommentComposer.tsx`
- `src/features/source-control/ui/DiffLayoutToggle.tsx`
- `src/features/source-control/ui/DiffOverviewRuler.tsx`
- `src/features/source-control/ui/GitActionsMenu.tsx`
- `src/features/source-control/ui/GitChangesPanel.tsx`
- `src/features/source-control/ui/GitCommitBlameView.tsx`
- `src/features/source-control/ui/GitConflictCompare.tsx`
- `src/features/source-control/ui/GitConflictRows.tsx`
- `src/features/source-control/ui/GitFeedback.tsx`
- `src/features/source-control/ui/GitFileInspector.tsx`
- `src/features/source-control/ui/GitGenerationSettings.tsx`
- `src/features/source-control/ui/GitGraphBranches.tsx`
- `src/features/source-control/ui/GitGraphColumnFilter.tsx`
- `src/features/source-control/ui/GitGraphCommitInspector.tsx`
- `src/features/source-control/ui/GitGraphConflictEditor.tsx`
- `src/features/source-control/ui/GitGraphDialog.tsx`
- `src/features/source-control/ui/GitGraphHoverCard.tsx`
- `src/features/source-control/ui/GitGraphList.tsx`
- `src/features/source-control/ui/GitGraphParts.tsx`
- `src/features/source-control/ui/GitGraphWorkspace.tsx`
- `src/features/source-control/ui/GitHistoryGraph.tsx`
- `src/features/source-control/ui/GitOperationBanner.tsx`
- `src/features/source-control/ui/GitPickDialog.tsx`
- `src/features/source-control/ui/GitPickerTrigger.tsx`
- `src/features/source-control/ui/GitStashSection.tsx`
- `src/features/source-control/ui/MergeConflictEditor.tsx`
- `src/features/source-control/ui/QuickDeleteWorktreeDialog.tsx`
- `src/features/source-control/ui/RefNameDialog.tsx`
- `src/features/source-control/ui/SessionChangesDiff.tsx`
- `src/features/source-control/ui/SidebarWorktreeSwitcher.tsx`
- `src/features/source-control/ui/SourceControl.tsx`
- `src/features/source-control/ui/SwitchBranchDialog.tsx`
- `src/features/source-control/ui/UnifiedDiffView.tsx`
- `src/features/source-control/ui/WorkingTreeDiff.tsx`
- `src/features/source-control/ui/WorkspaceSourceControl.tsx`
- `src/features/source-control/ui/WorktreePicker.tsx`
- `src/features/source-control/ui/WorktreesPage.tsx`

### State, resources and app wiring

The complete implementation trees are `src/features/source-control/model/` (diffs, graph/filter/window state, checkout selection, conflict provenance, confirmation and worktree recovery) and `src/features/source-control/hooks/` (branches/worktrees/submodules, status and refresh resources). Preserve tests next to these modules. App entry points:

- `src/app/shell/Sidebar.tsx`
- `src/app/workspace/files/useRepositoryReviewOpen.ts`
- `src/app/workspace/files/useSourceControlSurfaces.ts`
- `src/app/workspace/projects/useWorkspaceDirectoryActions.ts`
- `src/app/workspace/projects/useWorktreeRemoval.ts`
- `src/app/workspace/projects/useWorktreeSelection.ts`
- `src/features/quick-composer/model/quickGitPopup.ts`
- `src/features/quick-composer/ui/QuickGitPopup.tsx`
- `src/features/quick-composer/ui/QuickWorkspaceControls.tsx`

### Host RPCs/tools, native and transport

`host/server.ts` dispatches `git.diff`, `git.branches`, `git.switch`, `git.createBranch`, `git.worktrees`, `git.worktreeCreate`, `git.index`, `git.fileDiff`, `git.action`. Native-shaped commands in `src/platform/tauri/fs.ts` and `host/workspace-commands.ts` cover all `git_` operations: diff/index/files/history/blame; stage/unstage/discard (single, bulk, contents); commit/undo; fetch/pull/push/sync; PR status/destination/create; branches/tags/remotes/stashes; merge/rebase/cherry-pick/revert/reset; operation status/abort/continue; conflict stages/resolution; trust; watch/unwatch/reset. Re-enumerate their actual dispatch cases before adding behavior. Conversation tools `checkpoints.status` and `checkpoints.diff` in `host/conversation-project-tools.ts` expose checkpoint reads, not approval for Git writes.

- `host/checkpoints.ts`
- `host/git-actions.ts`
- `host/git-branches.ts`
- `host/git-conflicts.ts`
- `host/git-mutations.ts`
- `host/git-start-gate.ts`
- `host/git-submodules.ts`
- `host/git-watch.ts`
- `host/git-worktrees.ts`
- `host/server.ts`
- `host/tasks.ts`
- `host/workspace-commands.ts`
- `host/workspace-contracts.ts`
- `host/workspace-mutations.ts`
- `host/workspace-rpc-contracts.ts`
- `host/workspace-service-contracts.ts`
- `host/workspace.ts`
- `src-tauri/src/checkpoint.rs`
- `src-tauri/src/checkpoint/turn.rs`
- `src-tauri/src/fs.rs`
- `src-tauri/src/git_conflicts.rs`
- `src-tauri/src/git_submodules.rs`
- `src-tauri/src/git_watch.rs`
- `src-tauri/src/worktree_lifecycle.rs`
- `src-tauri/src/worktrees.rs`
- `src/features/connections/model/remoteGitWatch.ts`
- `src/platform/tauri/fs.ts`

Managed `workspaces.*`, branch-delivery and exact rewind APIs are frozen contracts in the three workspace contract modules, not implemented by this card. Preserve source-control review and existing per-file checkpoint semantics when integrating them.

### Locales

`src/shared/i18n/git.ts` selects the Git locale channel; catalogs under `src/shared/i18n/locales/` use English sentence keys rather than a sourceControl dot-prefix. Re-enumerate translation calls in affected UI; search families `Worktree`, `Worktrees`, `Worktree settings`, `Worktree base branch`, `Worktree unavailable`, and commit/stage/branch labels. Check `src/shared/i18n/en-overrides.json` and `src/shared/i18n/tr-overrides.json`.

### Browser fixtures/specs

- `tests/browser/git-checkouts.spec.ts`
- `tests/browser/git-generation.css`
- `tests/browser/git-generation.html`
- `tests/browser/git-generation.spec.ts`
- `tests/browser/git-generation.tsx`
- `tests/browser/git-workspace.html`
- `tests/browser/git-workspace.spec.ts`
- `tests/browser/git-workspace.tsx`
- `tests/browser/merge-conflicts.html`
- `tests/browser/merge-conflicts.spec.ts`
- `tests/browser/merge-conflicts.tsx`
- `tests/browser/playwright.git-checkouts.config.ts`
- `tests/browser/playwright.merge-conflicts.config.ts`
- `tests/browser/playwright.worktrees.config.ts`
- `tests/browser/responsive-diff.spec.ts`
- `tests/browser/vite.git-checkouts.config.ts`
- `tests/browser/vite.merge-conflicts.config.ts`
- `tests/browser/vite.worktrees.config.ts`
- `tests/browser/worktrees.e2e.ts`
- `tests/browser/worktrees.html`
- `tests/browser/worktrees.tsx`

## Behavior to preserve

Keep repository, project and selected execution checkout distinct; show submodules as independent repositories. Preserve staged/unstaged split, selected line/hunk operations, binary/large-file handling, live refresh and open-file selection, conflict side/provenance and abort/continue recovery, history filters and graph scrolling, stash identity checks and destructive confirmations. General source-control commit/push/PR actions and managed delivery have distinct approval contracts. Never infer a successful read, empty status or delivered result from a failed operation. Protect dirty non-overlap and reject overlapping delivery.

## Acceptance and checks

- Exercise no repository, one/multiple checkouts, submodules, dirty/staged/untracked/deleted/binary files, conflict states, empty and long graph histories, stale status, branch and worktree dialogs, operation errors/retries, stash and guarded delivery paths relevant to the change.
- Run `pnpm vitest run src/features/source-control/ui/GitChangesPanel.test.ts src/features/source-control/ui/WorkspaceSourceControl.test.ts src/features/source-control/ui/UnifiedDiffViewSplit.test.ts src/features/source-control/model/workspaceRepositories.test.ts`; select adjacent conflict/worktree/graph checks when changed.
- Host Git changes require focused fake-repository tests, for example `pnpm test:host -- host/git-actions.test.ts host/git-mutations.test.ts host/git-worktrees.test.ts`. Native behavior needs focused Rust tests with an isolated Cargo target. Never test destructive operations against owner data.
- Exercise relevant fixtures at 1280/800 in light/dark with menus, graph inspector, split diff and error/pending states open. Save/open screenshots under `temp/verification/<id>/`; compare build status before diagnosing owner screenshots. Separate fixture from native/installed/released acceptance.

## Owner decisions

## Proposals

No additional product changes are proposed by this inventory.

## Known blockers and evidence limits

This frozen checkout has no mobile source directory. Mobile screen inventory and physical-device acceptance require the mobile source checkout. Source inspection and browser fixture stubs do not prove installed/native/Host behavior. Contract availability does not establish serving Host capability.

## Committed handoff references

Contracts baseline: `f26ac112404e326478adb687c23ca9cc032acfef`; contracts: `docs/reference/managed-workspaces.md`. Add implementation commits, checks, screenshots and build identity when behavior changes; scratch plans are not shipped behavior.

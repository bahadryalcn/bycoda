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

2026-10-27, conversation0567326f-aade-4baa-89f3-b44c6256ae9e, five Settings
Source Control screenshots, verbatim:

> Source Control ekranlarıda rezalet durumda bunlarında düzenlenmesi gerekiyor lütfen burayıda toparlıyalım audit çıkaralım

This requests audit/design, not new Git defaults, disk/retention values, owner
approval bypass or live repository changes. Worktrees are optional/lightweight;
current checkout is the current Host default. Preserve the V94 supersession in
feature-managed-workspaces, with Exact Git rewind separately opt-in.

## Settings Source Control audit extension, 2026-10-27

T2 audit baseline d8bf868fae841b8b391ce148487cd7d373ea9762, dirty shared main.
Scoped history d643b8bd9/22afc558f/00053a08e/cf3944cfb.22 inspected source files
unchanged from HEAD. Five captures have unknown installed/source inclusion.
Two native read-only reviews plus root; no live claim capability available,
available worktree/session state inspected. Card is not a concurrency lock.
Preserve staged/shared Host/updater/UI work; root owns only audit documents.

Full17-family surface checklist and13 findings (three V+S/ten S):
`temp/local/2026-10-27-settings-source-control-audit/AUDIT.md`; adjacent
REDESIGN.md is the repair/design brief. Evidence under the matching
`temp/verification/2026-10-27-settings-source-control-audit/` directory.

SettingsView stacks SourceControlSettings with WorktreesPage. Source owners:
`src/features/settings/ui/SourceControlSettings.tsx`,
`src/features/source-control/ui/GitGenerationSettings.tsx`, WorktreesPage.tsx and
WorktreesPage.module.css; model gitGenerationPreferences.ts/gitGenerationChoice.ts,
worktrees.ts and hooks useProjectWorktrees.ts/useProjectBranches.ts.
`src/features/workspaces/ui/WorkspacePolicySettings.tsx`,
WorkspaceDirectoryRemoval.tsx and WorkspaceReview.tsx own managed policy/storage/
pinning/cleanup/delivery. Read workspaceClient.ts, host/workspace-policy.ts,
workspace-cleanup.ts/workspace-rpc-contracts.ts and native worktrees.rs/
worktree_lifecycle.rs. Exact routes include workspaces.list/pin/storage.status,
projects.workspacePolicy.get/update and workspaces.cleanup.plan/apply/status;
native managed_worktree_removal_plan/apply differs from ordinary
git_worktree_create/check_remove/removal_review/remove. No remote-to-local fallback.

Propose scoped Workspaces/Policy/Git preferences navigation, bounded searchable
collections, nearby actions and one selected-row detail. This is a proposal, not
a selected default. Repair dirty policy refresh/review-close loss, mixed freshness,
UI/Host validation, whole resolved-policy override inheritance, storage after
cleanup, unknown publication, branch-discovery state, row errors, ordinary remote
mutation routing and preference persistence feedback. Managed paths are already
excluded from other Git worktrees; search/cache/late-response rejection exist.
Do not recount those as missing or permanently duplicated.

Preserve all fields, useful grouped advanced retention/storage/cache disclosures,
unknown values, global/project preference inheritance, Editor/Unified viewer
versus independent diff layout, explicit Save and whole Host-default reset scope.
Clean is not published or removable. Session counts include persisted IDs plus
live context. Icons already have names/tooltips. Keep owner/revision/expiry/SHA/
process/terminal/open-file/session guards, retained transcripts/branch, partial
completion and uncertain-result recovery. Review changes includes merge/publish
delivery, not merely a read-only diff; retain PR drafts and approvals.

81 existing tests/nine suites pass; static five-file scan[]. Worktrees.test,
QuickDeleteWorktreeDialog.test, model worktrees/worktreeRemovalControl/
worktreeRecovery/gitGenerationPreferences tests, workspaceClient/workspacePinning
and WorkspaceReview tests ran. Existing browser worktrees.e2e.ts and
git-generation.spec.ts are acceptance assets, not rerun/capture proof here.
New repairs and actual changed app light/dark1280/800/narrow/keyboard/reader/
reduced-motion, isolated native/remote Host and installed/mobile acceptance remain
unverified because no product patch/app/native/device run was performed. Diagram
light728/dark390 is schematic only. No code/Git/index/worktree/policy/Host state,
build/install/release/branch or commit changed. User guides change with delivered
behavior; this audit is ready for repair planning, not shipped implementation.

## Proposals

The original frozen inventory proposed no product changes. The scoped Settings
proposal and acceptance sequence now live in the audit extension above.

## Known blockers and evidence limits

The original frozen checkout had no mobile source directory. The2026-10-27
scoped refresh found mobile Git consumers in
`mobile/src/features/workspace/git-status.tsx`, git-stashes.tsx and git-selective.tsx.
No separate mobile managed policy/cleanup UI was found; do not infer parity.
Physical-device acceptance remains separate. Source/browser fixture stubs do not
prove installed/native/Host behavior or the serving Host's capability.

## Committed handoff references

Contracts baseline: `f26ac112404e326478adb687c23ca9cc032acfef`; contracts: `docs/reference/managed-workspaces.md`. Add implementation commits, checks, screenshots and build identity when behavior changes; scratch plans are not shipped behavior.

Inventory delivery: `4454ce32` on `bycoda/wt-model/s7` commits this code-backed
card and the worktree-first documentation. This reference establishes inventory
delivery only; product/runtime acceptance remains as described above.

## Markdown review scrollbar dependency, 2026-10-27

Register/brief `temp/local/2026-10-27-markdown-scroll-audit/`, card
feature-markdown-preview. File review keeps Source mounted behind Preview;
OverviewRuler can override inherited hidden visibility and pointer suppression,
painting a ghost band/marks and operating hidden split scrollTop. Confirmed
source case, owner screenshot runtime inclusion unknown. Contain inactive paint
and hit testing without losing Source undo/draft/layout state. Active split and
shared DiffOverviewRuler also draw a viewport band beside the real native bar;
clarify one thumb with useful change ticks. Inline is already one custom rail.
Preserve hunk/conflict/diagnostic navigation, gesture/zoom/native overlay and Git
authority.111 related existing tests/15 suites pass; no Git operation, product
patch or actual rendered/native/installed acceptance delivered by this audit.

## Diff toolbar icon/layout audit extension, 2026-10-27

Owner conversation0567326f-aade-4baa-89f3-b44c6256ae9e, verbatim:

> git diff ekranı bu şekilde gözüküyor neden bunlar side by side view ikon filan değil ki alt satıra kayıyor filan bunlarında düzeltilmesi gerekiyor. Audit e eklenebilir.

T1 audit addition: six records (two V+S/four S), two direct owners/eight routed
families. Register/repair brief `temp/local/2026-10-27-diff-toolbar-audit/AUDIT.md`;
evidence `temp/verification/2026-10-27-diff-toolbar-audit/`. Root main@d8bf868f,
source0.6.94; installed screenshot inclusion unknown. Root plus one native
read-only review; concurrent shared Button/ButtonGroup work preserved.

DiffChunkNav/UnifiedDiffView fix height at2rem while default Select minimum is
2.25rem; source supports protrusion, not a demonstrated flex-wrap bug. Selected
text and separate diff row dominate the screenshot. Propose compact shared
Button icon trigger plus DropdownMenu checked radio options Automatic/Inline/
Side-by-side, meaningful label/focus tooltip and one row of nearby hunk or
expand/collapse actions. Preserve tab drag/close and ordinary versus review
context. Do not CSS-hide Select text or make ButtonGroup a fake radiogroup.

Cover CodeMirrorEditor and UnifiedDiffView, routed through WorkingTreeDiff,
CommitDiff, SessionChangesDiff, GitGraphCommitInspector, GitGraphConflictEditor,
GitConflictCompare and InboxPrDiff. Preserve auto default/actual surface900px/
zero-width retention, explicit choices, conflict/no-original constraints, drafts/
undo/focus and Git-domain labels. Saved preference is not always rendered layout.
Same-window sync exists; sibling storage opt-in is missing for diffLayout and
save outcome is swallowed. Repair honest state through the existing owner.

No app/control/preference/Git/Host/native/index/branch/build/install/release
change in this audit. Actual toolbar geometry1280/800 light/dark/narrow/zoom,
icon/keyboard/reader/native popup, sibling recovery and installed acceptance
remain unverified. 29 existing tests/five suites pass.
Existing Select-specific interaction tests need adaptation
with their behavior assertions retained when the implementation changes.

## Git sidebar/panel design audit extension, 2026-10-27

Owner, T3 thread0567326f-aade-4baa-89f3-b44c6256ae9e, verbatim:

> git paneli bu şekilde gözüküyor ama hiç iyi durumda değil bence daha iyi olabilirdi buranın da daha güzel şekilde design edilmesi gerekiyor.

T2 audit only:12 records (five V+S/seven S),18 surface/state families in
`temp/local/2026-10-27-git-panel-audit/AUDIT.md`; proposal REDESIGN.md and evidence
`temp/verification/2026-10-27-git-panel-audit/`. Root main@d8bf868f, source0.6.94;
installed screenshot inclusion unknown. Root plus two native read-only reviewers;
concurrent Sidebar/shared Button/package/Host changes preserved, claims API gap
recorded. No new Git reservation, application change or live operation.

Source findings: shell totals use gitRoot while review target changes locally;
initial/single-checkout discovery fallback hides its error. Error raw detail
exists but title-only Details is obscure. Header commit eligibility omits pending
generation while late generation replaces message; source-backed race needs a
deferred regression. Diagnostic copy/note feedback also lacks context identity.
Filter affects display, not repository-wide All actions, and result sum counts
staged/unstaged entries under files. Explicit scope/unit labeling is required.

Design proposal: compact context/feedback/commit composition, clear upstream and
incoming/outgoing commit semantics, collision-aware path hierarchy, existing
filter/tree/list and virtualized scroll ownership, secondary stash/history and
visually separate workspace Working activity (agent count, not Git). Reuse the
existing shared SplitButton with independent primary/menu enabled states; no
screen-local duplicate or blanket disabling. Keep generation settings adjacent
and disclose effective inherited provider/model/default-account provenance.

Preserve three authorities: workspace/session focus, Git review target and
execution checkout. Retain All/pending selection, repository-owned callbacks,
draft/queue/cancel/operation leases, smart/staged/all/amend/signoff, selected/
folder/All scopes, conflicts/Continue/Abort, default-branch/pushed-amend guards,
partial publication retry without duplicate commit, raw diagnostics and existing
permission/capability gates. Keep28px virtualization and keyboard kind/path
identity, parent scroll in grouped repositories and saved tree/list choice.

186 existing tests/15 suites pass, with five act-environment warnings retained
in the evidence ledger. Actual implemented
UI1280/800 light/dark/narrow, reader/native/remote/real Git/provider and installed
acceptance remain unverified in this audit. No build/install/release or commit.

## Host/WS source integration (2026-10-27)

Nine explicit Git RPCs now share host/domains/git/service.ts and neutral git.ts DTOs across HTTP/WS. Existing Git algorithms/gates remain owners; grant is rechecked after the real repo mutex and project/worktree resolution. Broad workspace.run Git tools remain unconverted. TempGit staging checks do not prove installed source-control acceptance.

Source only, uncommitted; no build/install/release stamp. Current full checklist and overlapping evidence: feature-host-runtime/SKILL.md and the local IMPLEMENTATION ledger.

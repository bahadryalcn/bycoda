---
name: feature-managed-workspaces
description: Worktree-first workspace ownership, creation, execution cwd, feature claims, branch delivery, retention, Windows-safe removal, Git rewind and build provenance in bycoda.
---

# Managed workspaces

## Purpose and keywords

Keep each independent coding writer on an owned branch/directory while preserving
project identity, recovery and owner-controlled delivery. Keywords: worktree,
workspaceId, current mode, base SHA, branch, merge, PR, cleanup, retention, pin,
storage budget, rewind, Undo, checkpoint, feature claim, bootstrap, ports, build
stamp. Read `docs/reference/managed-workspaces.md` and the contract modules before
changing this feature. Coordinate live claims; this tracked card is not a lock.

## Surface inventory

Inventory baseline: `f26ac112404e326478adb687c23ca9cc032acfef`, 2026-10-26.
Search roots: `src/app/`, `src/features/`, `host/`, `src-tauri/src/`,
`src/shared/i18n/`, `tests/browser/`, `scripts/local-update/`, build configs.
Search terms: worktree, workspace, rewind, checkpoint, build identity and exact
command names below. These are existing surfaces or frozen contracts, not a
claim that the new end-to-end model is routed or accepted.

### Contracts, instructions and docs

- `host/workspace-contracts.ts`: records, naming prefixes, policy, feature claims,
  operation journals, rewind/delivery/removal plans, bootstrap, ports and manifest.
- `host/workspace-rpc-contracts.ts`, `host/workspace-service-contracts.ts` and
  `src/features/workspaces/model/contracts.ts`: frozen wire/service boundaries.
- `AGENTS.md`, `.artifact`, `.agents/skills/feature-card-template/SKILL.md`,
  `docs/reference/managed-workspaces.md`, `docs/guides/managed-workspaces.md`,
  `docs/local-update.md`: worker policy, placement, card and user workflow.
- `src/integrations/harness/core/runtimeGuidance.ts`,
  `src/integrations/harness/core/conversationToolsBridge.ts`, `host/skills.ts`:
  runtime feature guidance and project skill discovery.

### Desktop creation, identity and management

- `src/features/workspace/ui/WorkspacePicker.tsx` and
  `src/features/sessions/ui/Composer.tsx`: blank-session workspace/base choice.
- `src/features/source-control/ui/WorktreesPage.tsx`,
  `src/features/source-control/ui/WorktreePicker.tsx`,
  `src/features/source-control/ui/SidebarWorktreeSwitcher.tsx`,
  `src/features/source-control/ui/CreateWorktreeDialog.tsx`,
  `src/features/source-control/ui/DeleteWorktreeDialog.tsx`,
  `src/features/source-control/ui/QuickDeleteWorktreeDialog.tsx`: management,
  selection, create/remove reviews and recovery.
- `src/features/source-control/ui/WorkspaceSourceControl.tsx`,
  `src/features/source-control/ui/SourceControl.tsx`,
  `src/features/source-control/ui/GitChangesPanel.tsx`,
  `src/features/source-control/ui/GitGraphWorkspace.tsx`: checkout-scoped Git
  operations and legacy commit/push/PR controls. They require delivery-gate wiring.
- `src/features/settings/ui/SettingsView.tsx`,
  `src/features/settings/ui/WorkspaceSettings.tsx`,
  `src/features/settings/ui/SourceControlSettings.tsx`: existing settings hosts;
  new lifecycle/policy controls are integration work, not baseline guarantees.
- `src/app/workspace/projects/useWorkspaceDirectoryActions.ts`,
  `src/app/workspace/projects/useWorktreeSelection.ts`,
  `src/app/workspace/projects/useWorktreeRemoval.ts`,
  `src/app/model/newWorkspaceSession.ts`,
  `src/app/workspace/sessions/submit/submitTurnRun.ts`,
  `src/app/workspace/derived/useActiveWorkspaceContext.ts`: create/execute/remove
  wiring; `src/features/sessions/model/session.ts` owns compatibility fields.
- `src/features/source-control/model/worktrees.ts`,
  `src/features/source-control/model/worktreeManagement.ts`,
  `src/features/source-control/model/worktreeRemovalControl.ts`,
  `src/features/source-control/model/worktreeFocus.ts` and
  `src/features/projects/model/linkedWorkspace.ts`: operation, removal, focus and
  linked project state. Preserve `cwd` versus execution-path distinction.

### Rewind, review and independent writers

- `src/app/workspace/sessions/useCompactAndRewind.ts`,
  `src/features/sessions/model/conversationRewind.ts`,
  `src/features/sessions/model/conversationRewindStrategy.ts`,
  `src/features/sessions/ui/AgentTranscript.tsx`,
  `src/features/sessions/ui/SessionReview.tsx`: conversation boundaries, legacy
  rewind and per-file checkpoint review; these are separate contracts.
- `src/integrations/harness/providers/codex/codex.ts`,
  `src/integrations/harness/providers/opencode/opencodeClient.ts`: opaque provider
  reverts must not double-restore files with authoritative managed Git rewind.
- `src/features/tasks/ui/TasksView.tsx`,
  `src/features/tasks/ui/TaskWorkspacePicker.tsx`,
  `src/features/tasks/ui/TaskWorkflowControls.tsx`,
  `src/features/tasks/model/hostTasks.ts`,
  `src/features/tasks/model/taskWorkspace.ts`: task workspace, dependency and
  delivery controls; see the tasks/goals card for the full task surface tree.
- `src/features/orchestration/model/orchestrationWorkspace.ts`,
  `src/features/automations/model/automations.ts`,
  `src/app/workspace/bridges/useAutomationLaunch.ts`: additional writer creation.

### Host/native operations

- `host/git-worktrees.ts`, `host/workspace-commands.ts`, `host/workspace.ts`,
  `host/server.ts`: existing Git list/create/remove routing and workspace commands.
  Native bridge identifiers in `src/features/source-control/model/worktrees.ts`:
  `git_worktrees`, `git_worktree_create`, `git_orchestration_worktree_create`,
  `git_worktree_rename_branch`, `git_worktree_check_remove`,
  `git_worktree_removal_review`, `git_worktree_remove`,
  `git_orchestration_worktree_remove`, `git_orchestration_branch_remove`.
- `host/engine.ts`, `host/checkpoints.ts`, `host/checkpoint-leases.ts`,
  `host/conversation-workspace-tools.ts`, `host/conversation-tools.ts`: session
  rewind and checkpoint status/diff/change paths. Existing capability
  `sessions.rewind` does not establish `sessions.git-rewind.v1` availability.
- `host/tasks.ts`, `host/task-workspace.ts`, `host/task-worktree-cleanup.ts`,
  `host/goals.ts`, `host/automations.ts`, `host/stewards.ts`,
  `host/conversation-task-tools.ts`, `host/conversation-goal-tools.ts`,
  `host/conversation-steward-tools.ts`: orchestrators and agent writer tools;
  `host/git-actions.ts`, `host/git-mutations.ts` own general Git mutation paths.
- Frozen RPC families (not baseline dispatcher claims):
  `workspaces.prepare/get/list/resume/finish/close`,
  `projects.workspacePolicy.get/update`,
  `workspaces.featureClaims.list/acquire/release`,
  `sessions.rewind.plan/apply/undo`,
  `workspaces.delivery.review/merge/publish`,
  `workspaces.cleanup.plan/apply/status`, `workspaces.storage.status`.
  Consult the RPC contract for full method strings, request revisions and tokens.
- `src-tauri/src/worktrees.rs`, `src-tauri/src/worktree_lifecycle.rs`,
  `src-tauri/src/checkpoint.rs`, `src-tauri/src/checkpoint/turn.rs`,
  `src-tauri/src/checkpoint/leases.rs`, `src-tauri/src/session_store.rs`,
  `src-tauri/src/lib.rs`: native Git, leases, persistence and registration.
- `host/dev-servers.ts`, `src-tauri/src/local_host.rs`,
  `src-tauri/src/bundled_host.rs`, `src-tauri/src/windows_instance.rs`,
  `scripts/local-update/local_update.py`, `vite.config.ts`,
  `src-tauri/tauri.conf.json`: development ports, data/executable identity and
  frozen-source packaging; s0 types alone do not implement isolation.

### Mobile, localization and browser surfaces

- `mobile/` is absent from this committed base. No mobile screen can be enumerated
  or accepted here. Existing access bridges include
  `src/features/connections/model/sshMobileWorkspaceControl.ts`; screen inventory
  requires the integrated mobile tree, not guesses about route names.
- Locale catalogs use English message keys in `src/shared/i18n/locales/en.json`
  and sibling language JSON files, not invented workspace.* prefixes. Search
  textual families `worktree`, `branch`, `Rewind`, `Undo`, `Create worktree`,
  `Search worktrees`, `This worktree is no longer available.` and checkpoint
  recording warnings. Git channel: `src/shared/i18n/git.ts`.
- `tests/browser/worktrees.tsx`, `tests/browser/worktrees.html`,
  `tests/browser/worktrees.e2e.ts`, `tests/browser/playwright.worktrees.config.ts`,
  `tests/browser/vite.worktrees.config.ts`: management fixture and matrix.
- `tests/browser/git-workspace.tsx`, `tests/browser/git-workspace.html`,
  `tests/browser/git-workspace.spec.ts`, `tests/browser/git-checkouts.spec.ts`,
  `tests/browser/playwright.git-checkouts.config.ts`,
  `tests/browser/vite.git-checkouts.config.ts`: checkout/Git scopes.
- `tests/browser/transcript.tsx`, `tests/browser/transcript.html`,
  `tests/browser/transcript-rewind.spec.ts`: rewind action identification.
- `tests/browser/project-workspace-navigation.tsx`,
  `tests/browser/project-workspace-navigation.html`,
  `tests/browser/project-workspace-navigation.spec.ts`,
  `tests/browser/playwright.workspace-navigation.config.ts`,
  `tests/browser/vite.workspace-navigation.config.ts`,
  `tests/browser/workspace-settings.e2e.ts`: project/navigation/settings surfaces.

## Owner decisions

## Behavior to preserve

One independent writer per owned workspace; immutable base; no fallback to main;
existing current sessions remain there without committing until migrated. No
profile edits, silent installation or delivery authority. Preserve drafts,
validation, async recovery, conversations, branches, staged state and rescue refs.
Removal is not branch deletion. Active/dirty/unknown/in-use state blocks automatic
cleanup. Rewind must be exact or visibly unavailable; published/integration history
is unchanged. Follow the authoritative reference for retention, approval and
no-follow Windows removal protocols.

## Checks and visual scenarios

- Instruction/runtime: `pnpm vitest run src/integrations/harness/core/runtimeGuidance.test.ts`;
  `node scripts/checks/check-repository-hygiene.mjs`; UTF-8 byte limit and cited
  paths/frontmatter validation. These do not prove managed-workspace behavior.
- Existing model tests: `pnpm vitest run src/features/source-control/model/worktrees.test.ts src/features/source-control/model/worktreeRemovalControl.test.ts src/features/sessions/model/conversationRewind.test.ts src/features/sessions/model/conversationRewindStrategy.test.ts`.
- Existing Host behavior: `pnpm test:host -- host/git-worktrees.test.ts host/checkpoints.test.ts host/checkpoint-leases.test.ts host/task-worktree-cleanup.test.ts`.
  Native behavior: `cargo test --manifest-path src-tauri/Cargo.toml checkpoint`
  with an assigned isolated Cargo target directory.
- After stream integration, use the per-owner acceptance table in
  `docs/reference/managed-workspaces.md`: fake Git repos, all failure phases,
  sibling preservation, staged/unstaged/untracked restore/Undo, SHA-bound owner
  approval, dirty overlap gates, dependency resume, cleanup link-target integrity,
  storage limits, concurrent dev environments and source/build comparison.
- UI matrix: every affected create/select/settings/review/remove/rewind/Undo
  surface at 1280 and 800, light/dark; keyboard/reduced motion; stale preview,
  old Host, unknown status, pin/Never, pending/error/cancel/retry and drift. Save
  and open screenshots under `temp/verification/<id>/`. Fixture results are
  distinct from isolated native/Host, installed and released evidence.

## Known blockers

The contracts baseline does not contain the other streams' managed service and UI
implementations. Capability routing, native acceptance and build comparison need
their integrated commits. Mobile sources are unavailable. Do not infer build
inclusion from semver or capture time; unstamped identity remains unknown.

## Committed handoff references

Contract baseline: `f26ac112404e326478adb687c23ca9cc032acfef`.
S7 documentation/runtime changes land on `bycoda/wt-model/s7`; resolve the latest
committed change with `git log --oneline -- .agents/skills/feature-managed-workspaces AGENTS.md docs/reference/managed-workspaces.md`.
No native, installed or released proof is recorded by this inventory.

## Proposals

No additional product behavior proposed. Refresh this inventory from committed
stream results after owner-controlled integration, recording evidence per surface.

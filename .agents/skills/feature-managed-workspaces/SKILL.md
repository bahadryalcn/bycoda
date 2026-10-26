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

Inventory refreshed from integrated I2 Host `b77b8f39` and I2 app `9f7c1e94`,
2026-10-26, on `bycoda/wt-model/integration`.
Search roots: `src/app/`, `src/features/`, `host/`, `src-tauri/src/`,
`src/shared/i18n/`, `tests/browser/`, `scripts/local-update/`, build configs.
Search terms: worktree, workspace, rewind, checkpoint, build identity and exact
command names below. The services and surfaces below are implemented in source;
runtime capabilities and exercised acceptance remain separate.

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
  operations and legacy commit/push/PR controls. Managed delivery is guarded by
  the Host owner review gate; legacy mutation dispatch cannot bypass it.
- `src/features/settings/ui/SettingsView.tsx`,
  `src/features/settings/ui/WorkspaceSettings.tsx`,
  `src/features/settings/ui/SourceControlSettings.tsx`: existing settings hosts;
  managed lifecycle/policy controls are hosted here through
  `src/features/workspaces/ui/WorkspacePolicySettings.tsx`.
- `src/features/settings/ui/GeneralSettings.tsx`,
  `src/features/settings/ui/BuildIdentityDetails.tsx` and
  `src/features/connections/ui/LocalHostUpdateNotice.tsx`: source stamp, copyable
  identity details and Host compatibility explanation.
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
  `src/features/sessions/ui/SessionReview.tsx`,
  `src/features/workspaces/model/rewindClient.ts`,
  `src/features/workspaces/ui/WorkspaceRewindPreview.tsx`: managed preview,
  operation recovery and Undo discovery; legacy current-mode rewind and per-file
  checkpoint review retain their separate contracts.
- `src/integrations/harness/providers/codex/codex.ts`,
  `src/integrations/harness/providers/opencode/opencodeClient.ts`: opaque provider
  reverts must not double-restore files with authoritative managed Git rewind.
- `src/features/tasks/ui/TasksView.tsx`,
  `src/features/tasks/ui/TaskWorkspacePicker.tsx`,
  `src/features/tasks/ui/TaskWorkflowControls.tsx`,
  `src/features/tasks/model/hostTasks.ts`,
  `src/features/tasks/model/taskWorkspace.ts`,
  `src/features/workspaces/model/taskWorkspaceState.ts`,
  `src/features/workspaces/ui/WorkspaceReview.tsx`: task workspace, dependency,
  artifact/finalization state and SHA-bound owner delivery; see the tasks/goals
  card for the full task surface tree.
- `src/features/orchestration/model/orchestrationWorkspace.ts`,
  `src/features/automations/model/automations.ts`,
  `src/app/workspace/bridges/useAutomationLaunch.ts`: additional writer creation.

### Host/native operations

- `host/managed-workspace-runtime.ts`: single production registry, history,
  delivery, activity, removal, retention, bootstrap and port service graph with
  startup recovery. `host/managed-native-turns.ts`,
  `host/managed-native-activity.ts` and `host/managed-native-rewind.ts` provide
  device-bound native coordination; unknown operations remain fenced.
- `src-tauri/src/native_workspace.rs`, `src-tauri/src/session_rewind.rs`,
  `src/app/workspace/files/useManagedWorkspaceBuffers.ts` and
  `src/features/workspaces/model/nativeManagedTurn.ts`: native process/buffer
  admission, turn capture, SQLite rescue/receipts and status-only read recovery.
  Native capabilities are required in addition to general managed capabilities.
- `host/git-worktrees.ts`, `host/workspace-commands.ts`, `host/workspace.ts`,
  `host/server.ts`: Git routing, authenticated managed owner RPCs and workspace commands.
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
- Routed managed RPC families:
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
  frozen-source packaging. `scripts/build/dev-native.mjs`,
  `scripts/build/dev-shot.mjs`, `scripts/build/build-status.mjs` implement isolated
  leased runs, stamped captures and bounded identity comparison.

### Mobile, localization and browser surfaces

- `mobile/` is a separate nested repository excluded from this branch. The
  authorized read-only inventory of `G:/Projects/my_projects/monocode/mobile`
  is recorded in `.agents/skills/feature-mobile/SKILL.md`, including routes,
  screens, RPCs, locales, tests and observed source identity. Existing desktop
  access bridges include `src/features/connections/model/sshMobileWorkspaceControl.ts`.
  This inventory does not establish mobile runtime acceptance or branch inclusion.
- Locale catalogs use English message keys in `src/shared/i18n/locales/en.json`
  and sibling language JSON files, not invented workspace.* prefixes. Search
  textual families `worktree`, `branch`, `Rewind`, `Undo`, `Create worktree`,
  `Search worktrees`, `This worktree is no longer available.` and checkpoint
  recording warnings. Git channel: `src/shared/i18n/git.ts`.
- `tests/browser/worktrees.tsx`, `tests/browser/worktrees.html`,
  `tests/browser/worktrees.e2e.ts`, `tests/browser/playwright.worktrees.config.ts`,
  `tests/browser/vite.worktrees.config.ts`: management fixture and matrix.
- `tests/browser/workspace-actions.tsx`, `workspace-rewind.tsx`,
  `build-identity.tsx` and their specs: owner review, policy, rewind/recovery and
  build-stamp fixtures. `tests/browser/tasks.tsx` exercises persisted Host task
  finalization and delivery fields.
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

- 2026-10-26, owner I3 stream brief in this integration session: "Merge
  `bycoda/wt-model/i2-host` then `bycoda/wt-model/i2-app` (`--no-ff`), resolving
  conflicts by preserving both intents."
- 2026-10-26, owner common worker rules in this integration session: "Commit your
  work on your own branch"; delivery remains limited by "Never push, never create
  PRs, never merge into `main`".

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

## Known limitations and acceptance boundary

The integrated tree contains managed service routing and the desktop/native
adapters. Missing or older execution-Host capabilities remain a visible blocker;
never infer native support from Host-only Git rewind. Native operations require
cross-store rescue, status and receipt acknowledgement before clearing fences.
The integrated Host now advertises `sessions.managedCreation.v1`,
`sessions.native-execution.v1`, `sessions.native-rewind.v1` and
`workspaces.native-activity.v1` for the implemented trusted endpoints.
Native process leases and stale/unknown app buffer reports are retained until
fresh authenticated reconciliation; another app cannot clear them. A managed
directory and branch both manually renamed before native persistence need
authoritative Host registry discovery, beyond native naming/path guards.

`host/managed-workspaces.e2e.test.ts` exercises real Git/SQLite production services
with fake providers. An isolated Windows native profile at `915dd790` additionally
passed two-session cross-store rewind/Undo, approved merge and safe retirement
using manual synthetic Git writers. Live providers, real GitHub publication,
simultaneous native apps in separate worktrees, physical devices and
installed/released behavior remain separate acceptance. Mobile source inventory is
available in its feature card; mobile runtime acceptance remains separate. Do not infer build
inclusion from semver or capture time; unstamped identity remains unknown.

## Committed handoff references

Contract baseline: `f26ac112404e326478adb687c23ca9cc032acfef`.
I2 Host wiring: `b77b8f39`; I2 app/native wiring: `9f7c1e94`.
I3 merges: `af6a9399` (Host) and `e2a71d1c` (app); resolve final integration fixes
and documentation commits with `git log --oneline -- host/managed-workspace-runtime.ts .agents/skills/feature-managed-workspaces docs/reference/managed-workspaces.md`.
I3 trusted transport and atomic native rewind receipts: `6d2fac1c`;
managed provider retirement: `2f4aff43`; composer/disclosure fixes: `c410c4e0`.
Native CDP readiness: `915dd790`; exact-run Host fixtures: `703a6e2c`;
managed RPC metrics: `b5cfc9c7`.
I3 local check logs/captures live under `temp/verification/i3/` and the final
handoff under `temp/local/i3/`; these are ignored local evidence, not runtime
product dependencies. No installed or released proof is recorded by this card.

## Proposals

No additional product behavior proposed. Record acceptance per surface after
owner-controlled integration and preserve the distinctions above.

Inventory delivery: `4454ce32` on `bycoda/wt-model/s7` commits this code-backed
card and the worktree-first documentation. This reference establishes inventory
delivery only; product/runtime acceptance remains as described above.

## F1 review repairs (2026-10-26)

- Host creation prepares an owned workspace for missing choices, including older
  authenticated clients. Explicit `workspaceMode: "current"` is the compatibility
  exception. Contextual legacy sessions receive independent branches. Interrupted
  legacy task branch/path identities remain outside automatic ownership until
  explicit migration. Implemented in `e0b2c9b7` and `b5820fe1`.
- Goal final reviewers retain authoritative execution-workspace identity across
  launch and receipt recovery, and verdicts are bound to the exact observed run
  after asynchronous snapshots (`4cab6491`). Opaque Host turn IDs are encoded only
  at recovery-ref/private-path boundaries; raw identities and safe legacy names
  remain unchanged (`69e6f537`). The real-Git goal suite passes 68 cases.
- Established current execution identity survives clear, persistence and restart
  through native `workspace_mode`; migration assigns no managed ownership.
  Implemented in `3221e80b`.
- Crew workers commit their owned branches. Acceptance waits for owner-approved
  managed branch delivery and rechecks unapproved commits; directory cleanup
  retains branches. Implemented in `8c386465` and `1c0a2d9a`.
- Native clean-close retirement and same-device/client predecessor reconciliation
  require authenticated reports and Host-verified process death. Dirty/unknown
  reports and uncertain process identity remain fenced. `10e2ef8d` adds
  `native.buffers.retire` and `native.buffers.reconcile`.
- Native rewind persists intent before Host preparation and discovers the same
  operation through authenticated `native.rewind.lookup` after restart
  (`49826b7d`). Authenticated `native.rewind.cancelPreparation` durably tombstones
  proven absent keys so rejected preparations permit a new preview while late
  requests stay rejected (`e495936b`). Unknown or mismatched acknowledgements
  retain the fence. Restore-owned index locks are journaled before admission and can
  be reclaimed only with matching lock evidence and positive process-death proof
  (`b4376caf`). Tests kill real native and Host subprocesses.
- Cleanup validates tracked dependency-link detachment before forced Git removal
  and retains its initially validated source fingerprint across the whole operation
  (`c4b92dd8`, `fc356a1b`); finished sessions expose guarded quick deletion (`5511dfab`).
  Build manifests omit dirty HEAD inclusion records, and both comparators reject
  same-HEAD/different-fingerprint claims (`fc03661c`).
- Focused regression evidence and the full-suite logs are under
  `temp/verification/f1/`; the handoff records final results and any follow-up
  validation fixes. Ordinary symlink tests run with real Git under Linux/WSL;
  Windows junction coverage is separate. Quick-delete captures cover both themes
  at 1280 and 800 and were opened for inspection. These are local and fixture
  acceptance, separate from installed/live-provider/released behavior.

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
  Migration also retains legacy sessions already cleared by an older app, while
  leaving unsent drafts unclassified. Implemented in `3221e80b` with the native
  migration/reopen regressions in `src-tauri/src/session_store.rs`.
- Crew workers commit their owned branches. Acceptance waits for owner-approved
  managed branch delivery and rechecks unapproved commits; directory cleanup
  retains branches. Implemented in `8c386465` and `1c0a2d9a`.
- F2 `877eef8d` preserves the selected lead's committed base, full branch and
  target directory through `workspaces.prepare.source`, registry persistence and
  creation recovery. `orchestratorWorkerBindings.ts` saves the source in the
  orchestration workspace and verifies both registry and reviewed delivery target
  before acceptance. A missing, detached or changed target is an error.
  `6f8d3f7b` adds real-Git Host and binding regressions for a prerequisite absent
  from integration, owner-approved lead delivery and wrong-target rejection.
- `e556061d` adds the contextual-session regression in
  `host/managed-workspace-runtime.test.ts` from a reopened old Host snapshot
  with neither `workspaceMode` nor `workspaceId`. It verifies independent
  workspace ownership, committed base, provider execution cwd and source retention.
  F2 evidence is under `temp/verification/f2/`; the final handoff distinguishes
  focused source/service checks from installed/native/provider acceptance.
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

## N1 native managed turn repair (2026-10-27)

Tier T2, branch `fix/native-managed-turns`, baseline `0a42b1ab`. Scope: native
provider admission, rejected/unknown begin recovery, accepted transcript revision
and the session notice action (eight implementation surfaces below). Live claim
APIs were unavailable; the owner assigned this isolated N1 workspace. Other
workspace ownership and delivery behavior is preserved.

Owner instruction, exact quote from the N1 stream brief in this session,
2026-10-27:

> Never release a row whose Host record shows a complete before-capture.

| Status | Surface                    | Implementation and checks                                                                                                                                                                                                                                                                          |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done   | Provider admission         | `host/native-activity-identity.ts`, `host/managed-native-activity.ts`, `host/managed-native-turns.ts`: one authenticated device/session provider may precede begin; accepted markers remain run-bound; foreign writers and duplicate providers block. Provider retirement is mandatory before end. |
| Done   | Rejected begin             | `host/managed-native-turns.ts`: before-capture rejection retires its marker and durably cancels its key; delayed begins cannot authorize it.                                                                                                                                                       |
| Done   | Recovery transport         | `host/server.ts` routes authenticated `native.turn.recover`; `src-tauri/src/remote.rs` permits that trusted route. Complete identity and revision acknowledgements are required.                                                                                                                   |
| Done   | Native revision            | `src-tauri/src/session_rewind.rs`: current accepted transcript boundary and starting-row reservation share one SQLite lock; stale session metadata cannot cause normal-send revision rejection.                                                                                                    |
| Done   | Native row recovery        | `src-tauri/src/session_rewind.rs`, registration in `lib.rs`: only matching `starting` rows release on Host proof; absent rows are local no-ops. Session-load reconciliation self-heals old rows; active/finishing or complete-before outcomes stay fenced.                                         |
| Done   | Next send                  | `src/features/workspaces/model/nativeManagedTurn.ts`: recovery precedes persistence and begin, preserving the fence and draft on unknown/negative responses.                                                                                                                                       |
| Done   | Session notice             | `AgentTranscript.tsx`, `SessionPane.tsx`, `ManagedTurnRecovery.tsx`, `managedTurnRecovery.ts`, `sessionIssue.ts`: latest local idle managed failure exposes shared Reset button with local pending, blocker, retry and success state; eight locale catalogs.                                       |
| Done   | Documentation and evidence | This card, managed workspace guide/reference; focused model, HTTP transport and real-Git Host regressions plus browser fixture matrix. Native/provider results are recorded separately below and in the N1 handoff.                                                                                |

Regression inventory: `host/managed-native-turns.test.ts` exercises provider-first
begin, foreign activity, three committed turns with rewind/Undo, rejected begins,
legacy restart recovery, complete-before fencing and delayed cancellation keys.
`managed-native-activity.test.ts` covers device/session process admission.
`src-tauri/src/session_rewind.rs` tests current revisions, rejected begin followed
by execution, unknown/mismatched HTTP acknowledgements and reopened SQLite rows.
`nativeManagedTurn.test.ts` and `submitModelSwitch.integration.test.ts` verify
recovery before save before begin. `ManagedTurnRecovery.test.ts` and
`managedTurnRecovery.test.ts` cover notice gating and local feedback.

Browser fixture: `tests/browser/transcript.html?native-turn-recovery` and
`transcript-rewind.spec.ts`: four Chromium cases passed; all sixteen light/dark,
1280/800 notice/pending/blocked/released captures were opened and reviewed under
`temp/verification/n1/`. These mock recovery IPC and do not establish native
provider acceptance. Isolated native evidence, final check results and immutable
commit references are recorded in the N1 handoff; installation/release remain
outside this stream.

Committed fixes: `570c5207` (revision), `573cfd27` (own process admission),
`e26c1f57` (notice action), `c7927040` (native recovery), `86ae09ae` (pre-save
recovery), `64cb6fbb` (Host cancellation/recovery), `41699dd2` (retirement before
after-capture), `e489b034` (frontend desktop client), `630396c6` (native caller
context) and `71c48b33` (authenticated busy publication ownership).

The actual desktop publishes busy before begin and keeps it through end. The
production Host probe in `host/server.ts` now scopes that synthetic mirror to
the matching authenticated device/client/session with a fresh positive busy or
desktop lease claim. A real Host execution, foreign window/device, unknown stored
running state, process, shell, terminal or dirty/unknown buffer remains fenced.
`src/integrations/harness/core/child.ts`, `src-tauri/src/harness.rs`,
`native_workspace.rs` and `remote.rs` carry optional current client context;
persisted legacy turn requests remain unchanged. Production HTTP coverage lives
in `host/managed-workspaces-rpc.test.ts`, including busy-before-begin and
busy-through-end with real Git commits and process retirement.

### N1 acceptance and build inclusion

- Isolated Windows native acceptance passed at clean product source
  `71c48b33588837a50ab0c2b6cde2c647339752a7`, build
  `dev-1793090162750-0d63895a91d1` (version 0.6.92, debug). Web, native and Host
  stamps match; all N1 product changes are included. No installer or owner update
  was performed.
- A fresh GPT-6-Luna/Codex session executed three consecutive real turns in
  workspace `7e2540e0-d6fe-4bae-8876-e8a4c99de170`: `ff22f9d`, `b31eb43`,
  `f41cb83`. Each edited and committed only `counter.txt`; the source repository
  main and sibling verification workspace stayed unchanged.
- Native UI rewind of the third turn restored `b31eb43` and exact `2\r\n` file
  bytes with two user turns. Undo restored `f41cb83`, exact `3\r\n`, all thirteen
  original transcript blocks, clean Git, native phase `complete` and no Host
  execution activities. Three Host before/after records are complete.
- Evidence: `temp/verification/n1/native-result.json`, `native-*-transcript.json`,
  `native-after-undo-db.json`, `native-turns/`, `native-rewind/`, `native-undo/`.
  All twelve native light/dark 1280/800 captures were opened and reviewed;
  metadata records exact source comparison and stable captures. Reset has the
  separate sixteen-image browser fixture matrix plus a real rejected-start
  recovery capture.
- Final source checks: web fast 12,408 passed/15 skipped; native modules and
  authenticated HTTP/desktop regressions 35 passed; Rust checkpoint 78 passed/
  one crash helper ignored, native workspace 3 passed, then changed native client
  transport 20 passed/one crash helper ignored. Clippy, Rust format, fast web/Host
  types and repository hygiene passed. The optional locale audit reports 5,359
  catalog issues, including baseline German `Connect {p0} in the browser`; new
  recovery keys are present in every catalog.

Pre-existing acceptance limitation: rewind message menus did not refresh after
the successful turns; reopening the native page exposed all three menus and
rewind/Undo then passed. The stable eligibility/memo structure is unchanged from
`0a42b1ab` (`SessionPane.tsx:947`, `AgentTranscript.tsx:1664` and `:2331` in this
delivery); the exact memo tier remains an inference. Follow up separately with
reactive eligibility and busy-to-idle/blocked-to-unblocked coverage. Initial
GPT-6.1-Sol capacity failure and the isolated Host directory ACL setup workaround
are documented in the local evidence report; neither is presented as successful
provider acceptance. The owner's two installed sessions remain unmodified.

## X1 cross-platform path repair (2026-10-27)

Scope: Host/native path identity, cleanup, rewind and automation execution on
`fix/cross-platform-workspaces`, baseline `506b0b46`. The owner assigned this
isolated stream; live claim APIs were unavailable. No UI source changed.

Owner instruction, exact quote from the X1 stream prompt, 2026-10-27:

> Symlink/junction rejection applies only to entries at or BELOW the canonical managed root/workspace (the things removal or rewind could traverse), never to ancestors of the root.

### Delivered surface checklist

| Status | Surface                               | Implementation and regression evidence                                                                                                                                                                                                                                                                               |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done   | Canonical identities                  | `host/workspace-paths.ts:18` resolves existing and missing paths and rejects linked endpoints; `.test.ts` covers linked ancestors and ordinary Windows path spelling.                                                                                                                                                |
| Done   | Registry and Git materialization      | `host/git-worktrees.ts:66`, `host/managed-workspaces.ts:188` normalize root, registration and selected target identities; registry tests use canonical fixture roots.                                                                                                                                                |
| Done   | Session and native activity admission | `host/managed-workspace-runtime.ts:275`, `host/managed-native-activity.ts:92` normalize legacy rows, create requests, stored sessions, process cwd and buffers; missing identity and linked workspace entries remain blocked. Broken siblings cannot admit work or block healthy candidates.                         |
| Done   | Turn capture and rewind/Undo          | `host/turn-git-history.ts:240`, `:341`, `:594` retain canonical operation paths; `host/session-rewind.test.ts` exercises rewind/Undo under a linked ancestor and refuses an internal unsafe link.                                                                                                                    |
| Done   | Automation                            | `host/automations.test.ts` exercises dispatch and settlement beneath a linked ancestor. The existing 20 second waits remain unchanged; the original timeout was blocked pre-provider turn capture.                                                                                                                   |
| Done   | Cleanup, recovery and storage         | `host/workspace-cleanup.ts:54`, `:507`, `host/workspace-retention.ts:238` fix a canonical boundary before traversal. Portable tests retain dirty/unknown fences, dependency-link detachment, source-drift checks, branches, rescue refs and outside sentinels.                                                       |
| Done   | Legacy task adapter                   | `host/task-worktree-cleanup.ts:16` uses canonical removal/process-fence keys; `.test.ts` verifies both alias spellings are fenced while removal runs.                                                                                                                                                                |
| Done   | Artifact review and transfer          | `host/task-delivery-artifacts.ts:117`, `host/task-artifacts.ts:27` normalize checkouts, then reject target links before Git ignore matching. Tests create junctions on Windows and directory symlinks on Unix; dependency-link fixture ignore rules cover both entry types.                                          |
| Done   | Native lifecycle and checkpoint Undo  | `src-tauri/src/worktree_lifecycle.rs:111`, `:157`, `src-tauri/src/worktrees.rs:639`, `:1019`, `src-tauri/src/fs.rs:7464` preserve fixed traversal boundaries and ordinary Windows path exports. Native lifecycle/removal and checkpoint Undo tests include linked ancestors and inside-link/outside-sentinel checks. |

### Acceptance and immutable delivery references

- `a6a0907e`: shared helpers, registry/runtime/native activity identity and Host
  rewind/automation regressions.
- `46a80a1f`: bounded Host cleanup/storage and portable artifact/dependency links.
- `284bb9fa`: legacy cleanup fencing, stable public history operation paths,
  destination-link preflight and canonical test expectations.
- `49fa0313`: native fixed-boundary removal/recovery and checkpoint Undo coverage.
- `c1ee2462`: legacy session/create path admission, canonical provider execution
  and missing-workspace-identity regression.

Windows native checks passed: worktree 35; rewind 18; checkpoint 74; Windows
prefix export 1; Clippy with `--workspace --all-targets -- -D warnings`; rustfmt.
The rewind/checkpoint filters each retain one intentional ignored subprocess
harness test. At final Host revision `c1ee2462`, both WSL runs passed all 25 files
(247 tests, one Windows-only skip), normally and with symlinked `TMPDIR`; web and
Host fast TypeScript checks passed. Windows exercised the same 25 affected files
in groups. Two earlier loaded-revision failures were corrected; the final rebuilt
Host/regression run passed 21 selected cases in six files, including both failed
cases, with 32 cases excluded by the explicit test-name filter. Full commands,
intermediate results and final evidence are under `temp/verification/x1/`.

The baseline WSL runs reproduced the three Ubuntu CI failures, 36 path-related
failures with linked `TMPDIR`, and the automation dispatch timeout. Actual macOS
Host/native and Linux native execution remain CI acceptance. No installer,
installed application, live provider or release acceptance was performed.

## X2 remaining cross-platform CI repair (2026-10-27)

Follow-up to CI run `40447216261`, from branch baseline `8c47b83d`:

- `5fee9399`: native removal fixture ignores the `node_modules` entry without a
  trailing slash and explicitly checks clean Git status. A POSIX directory
  symlink is a file entry to Git; dirty-source removal remains blocked.
- `f2b98120`: managed-workspace fake repositories set local `core.autocrlf=false`
  before their baseline commit, so checkout-byte assertions do not depend on the
  runner's global conversion policy. Product worktree creation retains Git's
  repository checkout behavior.
- `52c757dc`: the real-Git dependent-task test gets 60 seconds on every platform,
  matching its Windows budget and another real-Git scenario. The previous explicit
  5 seconds on non-Windows overrode the Host suite's 30-second default; the supplied
  Windows CI log completes the same test in 13.54 seconds.
- `d81ea3a7`: cleanup normalizes Windows extended path spelling before lexical
  containment, while retaining the boundary/descendant no-follow walk. Storage
  fixtures use native canonical paths, matching registry identity, and exercise a
  namespaced canonical descendant below a junctioned ancestor. Negative cases
  retain unknown results for linked roots, outside paths and missing directories.

A local Windows regression reproduced the storage `null` result for a valid
`\\?\` descendant before the fix, then passed afterwards. The exact original
runner trigger remains inferred: the supplied log does not contain its rejected
path or swallowed filesystem error. Ordinary C: and D: fixtures passed locally
before the fix; no inode or hardlink failure was reproduced.

Evidence is under `temp/verification/x2/`. Windows native worktree tests (35),
Clippy with warnings denied, rustfmt, and fast web/Host TypeScript checks passed.
Five Host/safety files passed under WSL both normally and with an isolated
`core.autocrlf=true` global config (121 tests, one Windows-only skip per run).
Linux native execution remains unavailable locally because WSL lacks Rust, a C
compiler and the GTK/WebKit development prerequisites; the POSIX Git ignore
behavior was reproduced directly. Actual macOS and new CI acceptance remain
unverified. No UI source or installed/released build changed.

Windows Host full-file coverage is green: normal mode passed all 68 goal tests
and a fresh final-source managed-workspaces/retention run passed all 37 tests.
The final three-file run with isolated `GIT_CONFIG_GLOBAL` and `core.autocrlf=true`
passed all 105 tests. An earlier normal run began before the namespace fix and
crossed source revisions: its newly discovered namespace regression failed,
while all other 104 tests passed. The final-source rerun above resolves that
intermediate failure. Full commands, JSON reports and acceptance limits are in
`temp/verification/x2/CHECKS.md`.

## C1 explicit current during Host update (2026-10-27)

Owner decision, C1 stream brief in this session: "an explicit owner choice is not
a silent fallback" and "Never silently fall back when the mode is unset/worktree."

Delivered from app baseline `745f4644` (0.6.91), on
`fix/composer-current-checkout`:

- `386450ff`, `src/features/workspaces/model/workspaceCreation.ts`: explicit
  current skips managed admission reads; unset/worktree keep capability/policy
  admission. Recovery or capability changes reload the observation and cancel
  stale responses. Capability notifications invalidate machine snapshots first.
- `0179bfc6`, `src/features/connections/ui/RemoteSession.tsx`: known old Hosts
  without `sessions.managedCreation.v1` use legacy creation only for explicit
  current, including shell-command/draft creation. They retain durable command
  identity and let the legacy Host allocate session identity. Unknown descriptors
  remain blocked; capable Hosts retain managed creation identity.
- `59ee0007`, `src/features/sessions/ui/Composer.tsx`,
  `src/features/workspaces/ui/WorkspaceCreationStatus.tsx` and
  `src/features/connections/model/bundledHostStatus.ts`: a local busy deferral
  explains automatic installation after active sessions finish. The shared Button
  action selects current for the draft. Failed/unknown/other deferrals do not
  claim proven active sessions, and local update state never describes a remote
  machine. Eight locales plus the Turkish override contain the new copy; English identity
  messages use the source-key fallback (`17927873`).
- `67857091`, `tests/browser/composer-host-compatibility.*`: real Composer/hook
  with fake native responses, isolated port 1447. With follow-up `72c9927c`,
  Chromium passed 10 cases; 12 light/dark captures were opened at 1280, plus 800
  for the error/action row.
  Evidence: `temp/verification/c1/BROWSER.md`. The full RemoteSession file passed
  120 cases; preserved-interaction/workspace checks passed 66 cases. Final
  client/hook/Composer checks passed 29 cases.
  `docs/guides/managed-workspaces.md` documents the owner choice.
- `496688b4`: hidden-footer/compact composers show the same local deferral
  explanation and explicit current action as the normal composer.
- `7509f4ca` (test constructor correction `54952faa`): stable app-side
  `WorkspaceCapabilityError` in `workspaceClient.ts` and the hook's
  `updateRequired` flag preserve recovery when the owner switches languages.
  No wire capability or Host contract changes. The 10-case browser suite passed
  again on this product source.

Final full web check passed 1,277 files/12,398 tests (four skipped files, 15
skipped tests) and fast tsc-rs. Fast app/Host TypeScript compilation, formatting
and repository hygiene also passed. The repository locale checker retains
exactly 5,359 baseline catalog issues with no new diagnostics; C1's two messages
are present in all eight catalogs. Command ledger:
`temp/verification/c1/CHECKS.md`.

The live claim API was unavailable; the explicit C1 brief established this
worker's scope. Local recovery/capability subscriptions use existing global
notifications; remote recovery filters environment identity. This is local
source/fixture evidence, with no installed-app, real Host upgrade, live provider
or release acceptance. No capability contract or publishing authority changed.

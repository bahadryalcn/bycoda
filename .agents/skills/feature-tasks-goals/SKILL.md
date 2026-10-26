---
name: feature-tasks-goals
description: "bycoda tasks, goals, sprints, stewards and background-work feature map: board, creation, dependencies, budgets, review, acceptance, execution workspaces and delivery. Read before changing task lifecycle, goal planning or agent tools."
---

# Tasks and goals

Purpose: turn authorized work into tracked execution with dependencies, budgets, acceptance evidence, review and deliberate delivery. Keywords: tasks, goals, sprints, stewards, background sessions, kanban, backlog, queue, planner, reviewer, worktree, delivery, merge, acceptance.

## Inventory and concurrency

Inventoried from the committed s0 contract baseline on 2026-10-26. Paths below exist in this worktree; implementation trees include their colocated tests and styles. Re-run the listed searches when the feature changes. This card records scope, not live ownership: consult host-authoritative feature claims for the canonical project and feature key before writing. If that capability is unavailable, report the coordination gap and agree a separate sub-scope; a tracked Active line is not a lock.

## Owner decisions

## Proposals

None recorded. Agent design suggestions belong here, separately from dated owner quotations.

## Surfaces

### Desktop board and controls

- `src/features/tasks/ui/BackgroundSessionDialog.tsx`
- `src/features/tasks/ui/SprintManagement.tsx`
- `src/features/tasks/ui/SprintPlanningControls.tsx`
- `src/features/tasks/ui/SprintReports.tsx`
- `src/features/tasks/ui/TaskAcceptanceEvidence.tsx`
- `src/features/tasks/ui/TaskAccountPicker.tsx`
- `src/features/tasks/ui/TaskAttemptHistory.tsx`
- `src/features/tasks/ui/TaskBudgetControls.tsx`
- `src/features/tasks/ui/TaskBulkToolbar.tsx`
- `src/features/tasks/ui/TaskList.tsx`
- `src/features/tasks/ui/TaskReviewNotes.tsx`
- `src/features/tasks/ui/TaskRunInsights.tsx`
- `src/features/tasks/ui/TaskSessionSheet.tsx`
- `src/features/tasks/ui/TaskWorkflowControls.tsx`
- `src/features/tasks/ui/TaskWorkspacePicker.tsx`
- `src/features/tasks/ui/TasksView.tsx`

All models, clients and colocated tests live in `src/features/tasks/model/`, including hostTasks, hostGoals, hostSprints, hostStewards, hostSettings; taskClient, goalClient, sprintClient, stewardClient, settingsClient, dailySummaryClient; taskAcceptance, taskBoardScope, taskBudget, taskBulkActions, taskChannel, taskInstructions, taskMetrics, taskPreflight, taskReviewNotes, taskRules, taskTransitions, taskWorkflows, taskWorkspace and useTaskBoardQueries.

### App wiring and neighboring surfaces

- `src/app/workspace/layout/WorkspaceToolPanels.tsx`
- `src/app/workspace/sessions/useSessionHousekeeping.ts`
- `src/app/workspace/surfaces/lazySurfaces.ts`
- `src/features/automations/model/hostAutomationClient.ts`
- `src/features/automations/model/machineSnapshot.ts`
- `src/features/notifications/hooks/useBackgroundNotifications.ts`
- `src/features/usage/ui/UsageBudgets.tsx`

### Host, RPC and conversation tools

- `host/conversation-goal-tools.ts`
- `host/conversation-steward-tools.ts`
- `host/conversation-task-queue-tools.ts`
- `host/conversation-task-tools.ts`
- `host/engine.ts`
- `host/goals.ts`
- `host/server.ts`
- `host/sprints.ts`
- `host/stewards.ts`
- `host/store.ts`
- `host/task-acceptance-snapshot.ts`
- `host/task-artifacts.ts`
- `host/task-budgets.ts`
- `host/task-handoff.ts`
- `host/task-preflight.ts`
- `host/task-workspace.ts`
- `host/task-worktree-cleanup.ts`
- `host/tasks.ts`
- `host/workspace-contracts.ts`
- `host/workspace-rpc-contracts.ts`
- `host/workspace-service-contracts.ts`

Dispatcher/tool identifiers found on this baseline: `goals.approve`, `goals.cancel`, `goals.create`, `goals.delete`, `goals.direct-checkout`, `goals.final-review`, `goals.final-review.recheck`, `goals.list`, `goals.replan`, `goals.settings`, `goals.update`, `host.settings.get`, `host.settings.save`, `sprints.archive`, `sprints.complete`, `sprints.create`, `sprints.get`, `sprints.goalContext`, `sprints.ingest`, `sprints.list`, `sprints.plan`, `sprints.report`, `sprints.start`, `sprints.update`, `stewards.create`, `stewards.decline`, `stewards.delete`, `stewards.list`, `stewards.pause`, `stewards.resume`, `stewards.runNow`, `stewards.save`, `stewards.stopRun`, `stewards.update`, `tasks.artifacts.list`, `tasks.blocked-takeover`, `tasks.continue-until-done`, `tasks.create`, `tasks.delete`, `tasks.dependencies.list`, `tasks.evaluation`, `tasks.evaluation.save`, `tasks.events`, `tasks.get`, `tasks.history.v1`, `tasks.list`, `tasks.move`, `tasks.notes`, `tasks.notes.read`, `tasks.notes.resolve`, `tasks.preflight`, `tasks.provider-accounts`, `tasks.queue.pause`, `tasks.reorder`, `tasks.retarget`, `tasks.retry`, `tasks.review-recheck`, `tasks.review.recheck`, `tasks.reviewer-profile`, `tasks.run-budget`, `tasks.save`, `tasks.session.read`, `tasks.snapshotWithCursor`, `tasks.sprints.v1`, `tasks.start`, `tasks.stop`, `tasks.todo`, `tasks.transfer`, `tasks.update`, `tasks.workspaces`, `tasks.write.authorize`. Tool schemas and owner-write authorization are distinct from owner UI RPCs; inspect dispatch and `host/conversation-tools.ts` for a requested action. Native transport uses `src-tauri/src/conversation_tools_bridge.rs` and `src-tauri/src/remote.rs`; persisted sessions use `src-tauri/src/session_store.rs` and handoff records use `src-tauri/src/handoff_history.rs`. There is no separate Rust task scheduler: task/goal scheduling is Host-owned. `src-tauri/src/automations.rs` and `src-tauri/src/jira/mobile_board.rs` are neighboring automation/board bridges, not task delivery authorization.

### Managed-workspace integration contract

`host/workspace-contracts.ts`, `host/workspace-rpc-contracts.ts` and `host/workspace-service-contracts.ts` freeze workspace owners, prepare/resume/finish, feature claims, activity reservations and SHA-bound delivery review/merge/publication. These contract declarations do not establish implemented or advertised support. Worktree-first migration must replace agent direct-mode forcing and suspend legacy automatic approvals; existing implementation must be checked at integration time.

### Mobile and localization

Mobile app sources are absent from this baseline, so mobile task/goal routes cannot be inventoried. Shared English-message keys live in `src/shared/i18n/locales/` and override files `src/shared/i18n/en-overrides.json` / `src/shared/i18n/tr-overrides.json`; there is no tasks namespace. Search exact visible text and prefixes Task, Goal, Sprint, Steward, Background, Daily, Review, Merge, Planned, Reports, Dependency and Pending sprint assignments.

### Browser fixtures/specs

- `tests/browser/host-tools-mocks.ts`
- `tests/browser/host-tools.e2e.ts`
- `tests/browser/host-tools.html`
- `tests/browser/host-tools.tsx`
- `tests/browser/operational-tools.html`
- `tests/browser/operational-tools.spec.ts`
- `tests/browser/operational-tools.tsx`
- `tests/browser/orchestration.html`
- `tests/browser/orchestration.spec.ts`
- `tests/browser/orchestration.tsx`
- `tests/browser/playwright.host-tools.config.ts`
- `tests/browser/playwright.operational-tools.config.ts`
- `tests/browser/playwright.orchestration.config.ts`
- `tests/browser/playwright.sprints.config.ts`
- `tests/browser/playwright.tasks.config.ts`
- `tests/browser/serve-host-tools.mjs`
- `tests/browser/serve-orchestration.mjs`
- `tests/browser/serve-settings.mjs`
- `tests/browser/serve-tasks.mjs`
- `tests/browser/sprintFixture.ts`
- `tests/browser/sprints.spec.ts`
- `tests/browser/tasks.html`
- `tests/browser/tasks.spec.ts`
- `tests/browser/tasks.tsx`
- `tests/browser/tools-workspace-resize.e2e.ts`
- `tests/browser/vite.host-tools.config.ts`
- `tests/browser/vite.operational-tools.config.ts`
- `tests/browser/vite.orchestration.config.ts`
- `tests/browser/vite.tasks.config.ts`

The tasks and sprints configs share the tasks fixture/server. Orchestration has its own fixture/server; operational-tools uses serve-settings with its own Vite config. Host-tools config selects host-tools and tools-workspace-resize specs, and its mock module is part of that fixture. These are scenario inventories, not evidence that any suite has run.

## Existing behavior to preserve

- Multi-machine board scope, query/event cursors, task ordering and bulk actions, filters, background session routing and honest disconnected-machine state.
- Drafts, custom provider/model/reasoning values, budgets, concurrency, manual start, preflight and dependency readiness. Omitted reviewer configuration and explicit null have different meanings.
- Task attempt history, artifact/handoff manifests, acceptance evidence, reviewer findings and rechecks. Implementation completion, review PASS, merge, installation and release are separate states.
- Goal planning/approval/replanning, final review, sprint assignment/recovery/reporting, steward scheduling and daily-limit reset.
- Preserve unrelated dirty target work, reject overlapping delivery and retain source/recovery records. Owner UI approval must bind reviewed identities; an agent task tool is not merge/push/PR authorization.

## Checks and visual acceptance

- Refresh inventories with `rg --files src/features/tasks host tests/browser` and search task/goal/sprint/steward names across app wiring, transport and i18n.
- Run focused behavior tests with `pnpm vitest run src/features/tasks/model/taskClient.test.ts src/features/tasks/model/taskTransitions.test.ts src/features/tasks/model/taskWorkspace.test.ts src/features/tasks/model/goalClient.test.ts src/features/tasks/ui/TasksView.test.ts`; run changed Host suites via `pnpm test:host -- host/tasks.test.ts host/goals.test.ts` with fake repositories and temp data, plus relevant task-delivery/sprint/steward suites.
- Exercise creation, board/list, details/session sheet, goal approval/replan, acceptance/review and delivery controls at 1280 and 800 widths in light/dark; save/open screenshots under `temp/verification/<id>/`. Cover long titles, empty/filter states, disconnected Hosts, queued dependencies, blocked preflight, budget limits, pending/cancel/error/retry, retained drafts and keyboard navigation.
- Use isolated native/dev Host runs for orchestration and delivery; fixture screenshots cannot prove a scheduler, actual merge or physical-device behavior. Compare build identity before diagnosing screenshots.

## Known concrete blockers

This baseline omits mobile app sources. The managed-workspace modules are contracts at the frozen s0 baseline; actual migration and capability wiring require integration verification. No task was scheduled and no live Host was touched for this inventory.

## Evidence and handoff

Committed inventory baseline: `f26ac112404e326478adb687c23ca9cc032acfef`. See `docs/reference/managed-workspaces.md` for frozen contracts, not proof of runtime availability. Record subsequent delivered behavior with a commit reference and exercised evidence. This documentation change did not exercise product UI, a native app, a physical phone, a live Host, installation or release.

Inventory delivery: `4454ce32` on `bycoda/wt-model/s7` commits this code-backed
card and the worktree-first documentation. This reference establishes inventory
delivery only; product/runtime acceptance remains as described above.

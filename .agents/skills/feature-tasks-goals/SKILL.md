---
name: feature-tasks-goals
description: "bycoda tasks, goals, sprints, stewards and background-work feature map: board, creation, dependencies, budgets, review, acceptance, execution workspaces and delivery. Read before changing task lifecycle, goal planning or agent tools."
---

# Tasks and goals

## Warm operation ownership dependency, 2026-10-30

The strict input component binds each original operation to the same retained
physical process through Native-issued receipts and opaque client views. It
does not make a physical process handle into a logical-turn cleanup grant.
Provider operation/high-water guards prevent old A cleanup regaining ownership
after B claims the same warm P; missing scoped records refuse. Native raw/admin,
CLI/MCP/final-effect and full Host/cohort attestation remain separate work.
Task/workspace delivery cannot infer those missing proofs from a successful
strict write. Local source evidence: `temp/verification/2026-10-30-warm-control/`.

## Original worker cleanup dependency, 2026-10-30

The desktop orchestrator bridges capture the actual child and Native control
turn before asynchronous worker cleanup. Family stops are joined, their failures
remain failures, and delivery/workspace removal cannot proceed on a failed
original cleanup. A late cleanup cannot resolve a replacement by session name.
This is a scoped backend/client dependency, with local evidence under
`temp/verification/2026-10-30-control-retirement/`; complete task/goal delivery,
Native GUI IPC and all-provider/alias/actor acceptance remain separate.

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
- `src/features/tasks/ui/TasksView.tsx` (composition only since 2026-10-29, UIC-16)
- `src/features/tasks/ui/TaskBoardColumns.tsx`, `TaskBoardCard.tsx`, `TaskDetail.tsx`, `TaskForm.tsx`, `TaskFormFields.tsx`
- `src/features/tasks/ui/TaskGoals.tsx` (`useTaskGoals`, goal dialogs/list), `TaskStewards.tsx` (`useTaskStewards`), `TaskSummaryPanel.tsx`, `TaskLimits.tsx` (limits panel; `CustomDailyLimit` keeps a dirty hours draft against the refreshed machine value, UIC-05)
- `src/features/tasks/ui/useTaskBoardOperations.ts` (shared pending/saving/error/refresh and board data state)

Confirmed board collections are owned by the `useTaskBoardQueries` cache. Mutations use its `putTask(s)`, `removeTask`, `putGoal`, `removeGoal`, `putSteward`, `removeSteward` and `putLimits` writers, which cancel in-flight machine reads before patching; TasksView keeps no local mirror of tasks/goals/stewards/limits. Drafts and selection stay local.

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

F1 managed final-review integration: `host/goals.ts` persists the accepted reviewer's `finalAcceptance.executionWorkspace` (`cwd` and optional `workspaceId`, declared in `src/features/tasks/model/hostGoals.ts`) at launch and receipt reattachment. Managed identity is checked against the authoritative registry's workspace/session IDs, owner, project, environment and path; legacy records retain their selected-checkout gate. Run, provider/profile, model, settings and permission-mode checks remain in force, including a fresh check of the exact session used to parse acceptance after asynchronous output snapshots. Failed pending-receipt ownership recovery blocks that goal without halting unrelated goals. `host/goals.test.ts` exercises managed acceptance, registry/record drift, receipt recovery, cancellation and later owner turns; `host/writer-workspaces.test-support.ts` uses real Git worktrees and mirrors session ownership into the test Host store. These source/fixture checks do not establish installed or live-provider acceptance.

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
- Run focused behavior tests with `pnpm vitest run src/features/tasks/model/taskClient.test.ts src/features/tasks/model/taskTransitions.test.ts src/features/tasks/model/taskWorkspace.test.ts src/features/tasks/model/goalClient.test.ts src/features/tasks/ui/TasksView.test.ts src/features/tasks/ui/TaskLimits.test.ts`; run changed Host suites via `pnpm test:host -- host/tasks.test.ts host/goals.test.ts` with fake repositories and temp data, plus relevant task-delivery/sprint/steward suites.
- Exercise creation, board/list, details/session sheet, goal approval/replan, acceptance/review and delivery controls at 1280 and 800 widths in light/dark; save/open screenshots under `temp/verification/<id>/`. Cover long titles, empty/filter states, disconnected Hosts, queued dependencies, blocked preflight, budget limits, pending/cancel/error/retry, retained drafts and keyboard navigation.
- Use isolated native/dev Host runs for orchestration and delivery; fixture screenshots cannot prove a scheduler, actual merge or physical-device behavior. Compare build identity before diagnosing screenshots.

## Notification daily-summary audit dependency, 2026-10-27

Current main d8bf868fae841b8b391ce148487cd7d373ea9762, audit/design only. See
`.agents/skills/feature-notifications/SKILL.md` and
`temp/local/2026-10-27-settings-notifications-audit/`. Gather filters locked
projects once; stored/fresh summaries omit project access identity and render
without a live lock check in TasksView SummaryPanel. Recheck on cached restore,
render and relock before accepting redesign. Ordinary Tasks/Goals lists already
use current lock state. This is a source acceptance risk, not demonstrated owner
data exposure. Cached-summary and sent-time setters also swallow failures,
allowing click-through/restart suppression to diverge from OS dispatch.
Preserve lead-window/no-overlap/local-day/late-open/retry and in-memory guards;
plan identity/storage migration and private-safe recovery through current Tasks/
native owners.161 notification-focused tests pass, not these proposed repairs.
No task, summary, Host, permission, private-data or app mutation in this audit.
Mobile sources are currently present as a separate nested repository; older
baseline omissions below are historical, not current device acceptance.

## Known concrete blockers

This baseline omits mobile app sources. The managed-workspace modules are contracts at the frozen s0 baseline; actual migration and capability wiring require integration verification. No task was scheduled and no live Host was touched for this inventory.

## Evidence and handoff

Committed inventory baseline: `f26ac112404e326478adb687c23ca9cc032acfef`. See `docs/reference/managed-workspaces.md` for frozen contracts, not proof of runtime availability. Record subsequent delivered behavior with a commit reference and exercised evidence. This documentation change did not exercise product UI, a native app, a physical phone, a live Host, installation or release.

Inventory delivery: `4454ce32` on `bycoda/wt-model/s7` commits this code-backed
card and the worktree-first documentation. This reference establishes inventory
delivery only; product/runtime acceptance remains as described above.

## Stewards Host/WS source follow-up (2026-10-28)

Coordinated W02/W07 sub-scope in the shared main checkout; this subsection is an
implementation record, not a live feature claim or transport availability stamp.

- `src/shared/model/host-contracts/stewards.ts` inventories the five actual RPCs:
  list, save, delete, runNow and decline. Finite closed input/result schemas retain
  all declared run/configuration metadata and complete expectedConfiguration
  snapshots used by the mobile editor. Named model settings remain string-valued;
  undeclared candidate/null fields are rejected. Desktop/mobile producers remain
  unchanged, with legacy owner parsing/defaults/coercions preserved by the service.
- `host/domains/stewards/service.ts` shares these operations across transports.
  Owner list is a pure SELECT/sort; proposal settlement and scheduled starts remain
  in the separate tick. Proposed capability is `transport.ws.stewards.v2`; list is
  a retry-safe query, and the four mutations are wait-only with no automatic retry.
  Registry/manifest/server composition is owned by the parent integration slice.
- `host/stewards.ts` checks request authority at SQL/provider/workspace boundaries.
  A pending run is recorded before external preparation; actual create/send IDs
  update only matching run metadata without replacing concurrent configuration or
  resurrecting a deleted row. Accepted provider work survives creator revocation
  or waiter cancellation. Denied preparation retains confirmed resource identities
  for later system-owned cleanup, and cleanup refuses unrelated workspaces.
  Actual committed deletion publishes onDelete while preserving proposal tasks.
- Focused source checks passed: 18 new DTO/actual-owner/service cases, two existing
  managed-worktree/shutdown cases, and normal Host tsc-rs. The DTO exporter accepted
  all schemas as deterministic draft-2020-12 JSON Schema. No app/native build,
  installed/live Host, physical-device, power-loss or release acceptance is claimed.

Observed HEAD `43a5a8ea3`; this follow-up remains uncommitted and is excluded from
that commit. Existing staged/dirty work was preserved.

## VIS-006 visual refinement (2026-10-29)

Uncommitted UI-only pass in `src/features/tasks/ui/`; no Host, RPC, lifecycle, budget or limit semantics changed.
- One header (`header.task-board-toolbar`): section switch, project/sprint scope, search, view switch, filters popover, select, More, refresh/status, New task. The separate section band and repeated scope text are gone.
- New task, edit task, new goal and goal settings share `.task-form`, `.task-form-body` (the single scroll region, `Modal scroll="none"`), `.task-form-options`/`.task-form-section` and `.task-form-footer` from `tasks.css`. "Working branch and worktree" is one disclosure heading (`TaskWorkspacePicker headingHidden`); the machine task limit block (`.task-form-limit`) no longer appears in the task form (V3-026 below); it remains only in the goal form.
- Board drop cues are theme-token only (`data-drop-active`, `data-drop-before`, `data-dragging`), cleared on drop, dragend and leave; list rows mark the open task and show status as a badge; empty Reports offers choose-sprint / Go to Sprints / Open backlog.
- Fixture evidence: `temp/verification/vis-tasks/`. Source/fixture checks only; no installed-app acceptance.

## V3-026 simple Tasks screen and New task (2026-10-31)

Owner, 2026-10-31, with screenshots of the New task dialog and the Backlog/Sprints/Reports views, exact quote:

> Tasks ekranı bu şekilde gözüküyor bence baya karmaşık ve gereksiz yine Task yoksa bunların hepsini ne yapıyoruz neden ihtiyacımız var onu bile anlamadık. Yani bu ekranı Gerçekten en salak insanın bile rahatlıkla kullanabileceği hale getirmen gerekiyor. Bir o kadar da güzel gözükmesi gerekiyor.

Delivered in source (uncommitted; no Host/RPC change; no checks run by the delivering agents):
- **Empty backlog:** `TasksEmptyState.tsx` shows one sentence, one `New task` button and a three-step "How it works" list. Summary, limits, stewards, project/filter controls and the toolbar `New task` button stay hidden until there is at least one task (`showOnboarding` in `TasksView.tsx`). Sprints and Reports have their own empty states; Reports only appears once a sprint exists.
- **Panels on demand:** summary, stewards and limits no longer repeat on every tab. They open from `More actions` (Summary, Stewards when a steward-capable machine exists, Limits when limits are known) and only render under Backlog. A short line ("N tasks · N running · agent time today") replaces the former summary block. The sprint filter moved into the Filters popover.
- **Limits panel:** per-machine task limit, daily agent time and used-today live in the `Limits` panel (`TaskLimits.tsx` `LimitsPanel`), not in the New task form. `MachineConcurrency` (`.task-form-limit`) remains only in the goal form.
- **New task default view:** title, description, project/machine, crew choice and a collapsed "Agent settings" row. **Advanced** is closed by default (it opens when the draft already uses a check command, budget, required resources or workflow) and holds Check command, Working branch and worktree, Workflow and Total run budget. Workflow save/refresh/remove sit under "Save or refresh workflows"; the preparation badge shows only after a workflow, resource or check exists and is neutral unless Ready/Blocked. Disabled footer actions explain themselves in a tooltip.
- Existing browser selectors in `tests/browser/tasks.spec.ts` were updated to open Advanced first (`openAdvanced`); no cases added.
- Unverified: light/dark and 800/1280 px screenshots, installed-build acceptance.

## UI standards round 2026-11-01 (uncommitted)

Round reference: owner request "tamam düzeltmelere başla lütfen hepsini" (2026-11-01, owner chat); primitives and rules in `docs/reference/ui-component-catalog.md` and `ui-design-system.md`. Source only, uncommitted on `main`; nothing built or installed.

Tasks, goals and Automations (`src/features/tasks/**`, `automations/**`; there is no separate Automations card), from `HANDOFF-w2-work-tasks.md` and `HANDOFF-w2-work-automations.md`. Drift tasks 33 -> 1, automations 8 -> 0.

- Done: Tasks section strip on `TabStrip`, Automations page tabs on `Tabs` (roving keys); TasksView and AutomationsView headers on `PaneHeader` + chrome inset; TaskGoals prompt on `PromptField`; date/time on `DateTimeField` (Sprint, Goals, Stewards); run limit on `NumberField`; `SectionLabel`, `Surface` cards, `Badge count`, `ActionHost` rows; `Spinner`/`LoadingText`, `InlineError`; footer buttons with `disabledReason` are now `aria-disabled` rather than natively disabled.
- Left: TaskForm and AutomationsView instruction frames stay hand-framed until `SkillPromptField` (`src/features/skills/ui`) renders `PromptField`; the task board card keeps one `hover:bg` (an `article`; `ActionHost` is a `div`); board/list toggle stays `SegmentedControl` (a display preference).
- Unverified: no screenshots or native run.

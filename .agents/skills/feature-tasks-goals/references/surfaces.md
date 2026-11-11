# Background work surface map

Paths are repository-root relative. Search the named task/goal/sprint/steward action through callers and exact current RPC schemas before widening scope.

- `src/features/tasks/ui/`: board/list, task creation/details/session sheet, `TasksView.tsx`, `TaskLimits.tsx`, `TaskWorkspacePicker.tsx`, `TaskWorkflowControls.tsx` and goal/sprint controls. Preserve stored filters, selection, creation drafts and review action state.
- `src/features/tasks/model/`: `taskClient.ts`, `taskTransitions.ts`, `taskWorkspace.ts`, `goalClient.ts`, `hostTasks.ts`, task rules/bulk action and related schemas. Follow event/query cursors rather than treating loaded rows as the whole multi-machine board.
- App/session/notification integration under `src/app/` and session UI opens retained background sessions, approvals and review results. Daily notification summaries consume work state; they do not own scheduler lifecycle.
- `host/tasks/service.ts` composes the task service; `host/tasks/tasks.ts` preserves its public exports. `task-actions.ts` and `storage.ts` own board actions and persistence; `scheduler.ts` owns tick/work; `launch.ts` owns workspace preparation and launch; `verification.ts`, `review.ts` and `recovery.ts` own settlement, review and retry; `delivery.ts` owns merge/reconcile/cleanup; `assistant-recovery.ts`, `assistant-holds.ts` and `goal-budget.ts` own assistant recovery and admission/budget holds. `host/domains/tasks/service.ts` remains the thin wire layer. Goals, stewards and existing sprint/automation owners retain their lifecycle ownership. Conversation tools keep separately scoped principals and approval gates.
- Stall diagnostics: `host/engine.ts` stamps current-run provider event receipt time;
  `host/sessions/session-run-activity.ts` excludes telemetry/metadata refreshes;
  `host/sessions/sessionRuns.ts` exposes only valid exact-run `lastActivityAt`.
  `host/tasks/verification.ts` persists `runStall` after 15 minutes without changing Task status,
  clears it on new output/input waits/attempt changes, and checks the unchanged row
  across reads. `model/taskStatusLine.ts` supplies the warning to card/list/detail;
  unknown legacy timestamps do not prove stalled work.
- Assistant follow-up badges: `host/assistant/work/assistant-task-metadata.ts` reads canonical
  task/job/session delivery receipts; `host/tasks/storage.ts` caches their projection by
  revision and source membership and includes it in the machine-change ETag.
  `AssistantTaskBadge.tsx` serves board and list. Unknown delivery stays separate;
  receipt-notification failure cannot invalidate an accepted action.
- `host/tasks/task-workspace.ts`, `host/tasks/task-worktree-cleanup.ts`, `host/tasks/task-handoff.ts`, `host/tasks/task-artifacts.ts`: workspace/delivery cleanup and artifact transfer. Inspect actual existing paths before changing persistence or cross-workspace delivery.
- `src/features/workspaces/model/taskWorkspaceState.ts`, `src/features/workspaces/ui/WorkspaceReview.tsx`, Host workspace contracts/services: reviewed delivery, SHA-bound identity and overlap recovery. Reuse `docs/reference/managed-workspaces.md` rather than another task-specific Git lifecycle.
- Mobile task/goal consumers live under nested `mobile/`; exact method/capability parity must be read from actual clients. Native adapters retain their own receipt and operation gates.
- Focused suites: `src/features/tasks/model/taskClient.test.ts`, `taskTransitions.test.ts`, `taskWorkspace.test.ts`, `goalClient.test.ts`; UI `TasksView.test.ts`, `TaskLimits.test.ts`; `host/tasks/tasks.test.ts`, `host/goals/goals.test.ts` and changed task delivery/sprint/steward suites.
- Browser family `tests/browser/tasks/tasks.tsx` and related goal/create/detail scenarios: empty/long titles, disconnected, queued dependencies, blocked preflight, budget, review and pending/retry. Search current locale sentence keys across the rendered controls and scheduler outcomes.

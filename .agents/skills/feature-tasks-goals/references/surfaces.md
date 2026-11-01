# Background work surface map

Paths are repository-root relative. Search the named task/goal/sprint/steward action through callers and exact current RPC schemas before widening scope.

- `src/features/tasks/ui/`: board/list, task creation/details/session sheet, `TasksView.tsx`, `TaskLimits.tsx`, `TaskWorkspacePicker.tsx`, `TaskWorkflowControls.tsx` and goal/sprint controls. Preserve stored filters, selection, creation drafts and review action state.
- `src/features/tasks/model/`: `taskClient.ts`, `taskTransitions.ts`, `taskWorkspace.ts`, `goalClient.ts`, `hostTasks.ts`, task rules/bulk action and related schemas. Follow event/query cursors rather than treating loaded rows as the whole multi-machine board.
- App/session/notification integration under `src/app/` and session UI opens retained background sessions, approvals and review results. Daily notification summaries consume work state; they do not own scheduler lifecycle.
- `host/tasks.ts`, `host/goals.ts`, `host/stewards.ts`, existing sprint/automation owners: state machine, persisted attempts, scheduling, budget/dependency/preflight and recovery. Conversation task/goal/steward tools keep separately scoped principals and approval gates.
- `host/task-workspace.ts`, `host/task-worktree-cleanup.ts`, `host/task-handoff.ts`, `host/task-artifacts.ts`: workspace/delivery cleanup and artifact transfer. Inspect actual existing paths before changing persistence or cross-workspace delivery.
- `src/features/workspaces/model/taskWorkspaceState.ts`, `src/features/workspaces/ui/WorkspaceReview.tsx`, Host workspace contracts/services: reviewed delivery, SHA-bound identity and overlap recovery. Reuse `docs/reference/managed-workspaces.md` rather than another task-specific Git lifecycle.
- Mobile task/goal consumers live under nested `mobile/`; exact method/capability parity must be read from actual clients. Native adapters retain their own receipt and operation gates.
- Focused suites: `src/features/tasks/model/taskClient.test.ts`, `taskTransitions.test.ts`, `taskWorkspace.test.ts`, `goalClient.test.ts`; UI `TasksView.test.ts`, `TaskLimits.test.ts`; `host/tasks.test.ts`, `host/goals.test.ts` and changed task delivery/sprint/steward suites.
- Browser family `tests/browser/tasks.tsx` and related goal/create/detail scenarios: empty/long titles, disconnected, queued dependencies, blocked preflight, budget, review and pending/retry. Search current locale sentence keys across the rendered controls and scheduler outcomes.

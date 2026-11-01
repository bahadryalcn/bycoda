---
name: feature-tasks-goals
description: "Change task boards, goals, sprints, stewards, budgets, dependencies, attempts, review/acceptance or execution workspace and delivery workflows."
---

# Tasks and goals

Own background-work lifecycle and UI. Crews owns team/member/run composition; managed-workspaces owns execution/delivery contracts; Host runtime owns operation writers and transport. A task tool or PASS result grants no merge/push/publication permission.

## Source entry points

Code paths below are repository-root relative.

- `src/features/tasks/ui/TasksView.tsx`
- `src/features/tasks/model/taskClient.ts`
- `host/tasks.ts`

## Workflow

1. Trace the changed board/detail/create/goal/sprint/steward action through client, persisted schema, Host scheduler and current capability.
2. Keep attempt/revision/request identity and dependency/budget/preflight state explicit. Resolve execution policy through the existing workspace service for every writer producer.
3. Preserve ongoing work and draft filters/selections while exposing pending, blocked, failed and review states at the affected task/control.
4. Exercise creation/manual start, dependency readiness, retries/unknown outcomes, goal approval/replanning, review/recheck and reviewed delivery as relevant.

## Preserve

- Preserve multi-machine board scope, query/event cursors, ordering, bulk-action populations and honest disconnected state.
- Keep custom provider/model/reasoning values, drafts, budgets/concurrency and manual-start policy. Omitted reviewer configuration differs from explicit null.
- Implementation completion, review PASS, acceptance, delivery/merge, installation and release are separate states with separate authority.
- Retain attempt history, artifact/handoff manifests, findings/rechecks, goal plan approval and sprint/steward recovery/reporting/daily-limit semantics.
- Owner UI approval binds reviewed identities; overlapping delivery must refuse without destroying unrelated dirty target work or source/recovery records.
- Autonomy contract: reviewed tasks from any source auto-correct within the repair limits. When correction is exhausted or only external checks remain, the task finishes through the PASS path with `completedWithFindings` and `ownerNotices`, keeps the FAIL verdict and always needs owner delivery approval. Transient runtime failures retry twice; unattended clarifying questions are skipped at most twice and recorded as notices. Only owner stops, budgets, dependency cycles, permission/credential gates, preparation failures and repeated runtime failures block.
- The reviewer FAILs only in-scope defects, regressions, failed checks and hard-constraint violations; out-of-scope edge cases are suggestions. `taskStatusLine` is the single owner-facing status/reason source for card, list and detail; notices show only after completion.
- Worker cleanup remains bound to original process/operation identity. Optional title/catalog work or permission revocation cannot certify physical retirement.

## Verification and references

- Select changed taskClient/taskTransitions/taskWorkspace/goalClient and TasksView/TaskLimits suites; scheduler changes need corresponding Host task/goal/sprint/steward/delivery cases.
- Use affected UI states and isolated dev-Host orchestration with fake repositories. Fixtures alone cannot prove a scheduler, actual delivery or a physical device.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Execution/delivery contract](../../../docs/reference/managed-workspaces.md)
- [Common Host authority](../../../docs/reference/host-runtime.md)

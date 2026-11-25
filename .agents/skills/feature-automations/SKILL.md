---
name: feature-automations
description: Use when changing automation schedules, missed runs and recovery. Not for task boards; see feature-tasks-goals.
---

# Automation development

Use for desktop automation scheduling and launches. Host task/goal scheduling belongs to `feature-tasks-goals`; SSH execution retains native runbook ownership.

Model order, pools, role bindings and delegation defaults belong to [model routing](../feature-model-routing/SKILL.md) in Settings > Models > Background work. Feature choices resolve at run start; existing running sessions keep their concrete model.

## Source starts

- `src/features/automations/model/automations.ts`: schedule math and native commands.
- `src/app/workspace/bridges/useAutomationLaunch.ts`: serialized session launch.
- `src-tauri/src/automations.rs`: persisted definitions, recovery and run transitions.
- `src-tauri/src/automations/admission_tests.rs`: native write-admission coverage.
- `host/automations/recipe-execution.ts` and `src/features/automations/model/automationRecipe.ts`: recipe steps, versions and instance advance; `RecipeStepsEditor`, `RecipeRunSteps` and `RepeatRecipeDialog` in `ui/`.

## Workflow

1. Trace occurrence claim and native admission before session creation.
2. Exercise overdue recovery with competing windows.
3. Trace SSH completion and unknown admission replies.

## Preserve

- Host scheduling selects indexed active/recovery runs before decoding history. Keep strict cleanup booleans, legacy truthiness, local-day limits and exact pending/unknown occurrence identity; query failure cannot become empty history or idle. Automatic event/due/recovery polling belongs to one canonical workspace window, including background scheduling while hidden. Tool/overlay windows never own it. Leader election only reduces duplicate reads; persisted claim, recovery and execution admission remain authoritative, including explicit launches from another window.
- Every await in the event and due pollers has a deadline (`automationPollDeadlines.ts`). A timed-out step is abandoned, never repeated: late reads are discarded, recovery is only awaited, event claims retry with the same recovery token, the due claim is awaited again, and an unsettled launch is not relaunched.
- A background automation carries `executor` and `helpers`; `default` re-resolves every occurrence under the automation role and a fixed model never falls back ([work executor](../feature-tasks-goals/references/work-executor.md)).
- A recipe is an automation with `recipe` steps ([decision](references/decisions.md)); its occurrences advance only from the existing tick (`settleRecipe`) and `automations.decide`, never from a second loop. An occurrence copies its steps and run settings when it starts, so a new recipe version never changes it. A step result is written in the transaction that creates the step's task (`createWork`, request id `<run>:<index>`); a step with a result is never created again, and an unreadable step task stops the occurrence with `step_uncertain` instead of repeating. A declined decision, a stopped step task and an owner stop end it with a structured `recipe.stop` (code, step, next action); behavior never reads its message.
- A steward is only a project-scan definition: `host/stewards/stewards.ts` keeps its saved configuration, proposals and declined titles, while its schedule, run and stop belong to the bound project-scan automation (`host/automations/steward-migration.ts`). The steward service has no scheduler or run state.
- Trace schedule selection through occurrence claim, run admission, session creation and completion. Keep timezone, project, provider, limits and native permissions.
- After an offline interval, claim only the newest overdue occurrence using the original persisted next-run value for compare-and-swap. Apply its grace period and advance to a future occurrence; never replay the complete missed interval.
- Recovery mutates persisted runs once per process after successful completion. Only the original recovering window can reread its result. Failed recovery may retry; another window must not recover active work again.
- Claim pending-to-running before session side effects. Reject duplicate admission without marking the original launch failed. Attach its session once and keep terminal transitions. An uncertain admission reply must not trigger a new launch.
- Keep native SSH outcomes owned by the SSH execution engine. General status updates never override them. Failed reads and unknown outcomes are not completed work.
- Run limits count confirmed monotonic intervals. A long or divergent observation gap is unknown, not proof of sleep or elapsed limit exhaustion.

## Focused checks

Run schedule/launch Vitest suites and native `automations` tests with injected clocks. Cover offline intervals, claim races, recovery retry, duplicate admission and terminal protection. Exercise multiple windows for runtime acceptance; unit tests alone do not prove delivery.

## References

User behavior: [assistant guide](../../../docs/guides/assistant.md). Connection outages: [remote access](../../../docs/guides/remote-access.md).

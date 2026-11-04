---
name: feature-automations
description: Change desktop automation schedules, missed occurrences, recovery and run admission while preserving permission gates, exact run identity and uncertain outcomes.
---

# Automation development

Use for desktop automation scheduling and launches. Host task/goal scheduling
belongs to `feature-tasks-goals`; SSH execution retains native runbook ownership.
Source paths below are repository-relative.

## Source starts

- `src/features/automations/model/automations.ts`: schedule math and native commands.
- `src/app/workspace/bridges/useAutomationLaunch.ts`: serialized session launch.
- `src-tauri/src/automations.rs`: persisted definitions, recovery and run transitions.
- `src-tauri/src/automations/admission_tests.rs`: native write-admission coverage.

## Workflow and contracts

1. Trace schedule selection through occurrence claim, run admission, session creation
   and completion. Preserve timezone, project, provider, limits and native permissions.
2. After an offline interval, claim only the newest overdue occurrence using the
   original persisted next-run value for compare-and-swap. Apply its grace period
   and advance to a future occurrence; never replay the complete missed interval.
3. Recovery mutates persisted runs once per process after successful completion.
   Only the original recovering window can reread its result. Failed recovery may
   retry; another window must not recover active work again.
4. Claim pending-to-running before session side effects. Reject duplicate admission
   without marking the original launch failed. Attach its session once and preserve
   terminal transitions. An uncertain admission reply must not trigger a new launch.
5. Keep native SSH outcomes owned by the SSH execution engine. General status updates
   never override them. Failed reads and unknown outcomes are not completed work.

## Checks and references

Run adjacent schedule/launch Vitest suites and native `automations` tests with
injected clocks. Include long offline intervals, concurrent claims, recovery retry,
duplicate launches and terminal status protection. Exercise multiple windows for
runtime acceptance; unit tests alone do not prove delivery.

User behavior: [assistant guide](../../../docs/guides/assistant.md).
Connection outages: [remote access](../../../docs/guides/remote-access.md).

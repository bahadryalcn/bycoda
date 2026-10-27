---
name: feature-session-recovery
description: Recovered sessions dialog/rail, attention/status verification, search/aliases, selection and bulk scopes, open/already-open/partial outcomes, previous chat layout, journal cleanup/dismissal, snapshot persistence, locked/remote identity and auto-continue holds. Read before recovery UI or workflow changes.
---

# Recovered sessions

Reopen saved conversation tabs or their prior chat splits with understandable
status and exact identity, preserving history, running work and recovery journal.
Keywords: Recovered sessions, previous sessions, restore previous layout, recovery
list, Open all, Clear completed, dismiss, snapshot, partial open, unavailable.

T2 inventory/design inspected2026-10-27 at dirty shared `main @
0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`; product migration pending. Recent
history29d534f9f,3419af022,dbf3c5491,d34c7b582. Search roots: app/shell,
app/workspace/sessions/layout, app/model, features/workspace/model,
sessions/data, connections, shared UI, native session_store and tests/browser.
Read feature-sessions-sidebar, feature-workbench-design and managed-workspaces
cards plus docs/reference/DESIGN.md, arc-ui.md and UI design/catalog guidance.
This recovery sub-scope does not overwrite concurrent sessions-sidebar footer
work. Card is not a lock; live claims unavailable, available Git/worktree/native
session state inspected without cross-machine reservation. Preserve concurrent
updater/sidebar/Host/shared Button/ButtonGroup/ComposerTips changes.

## Surface inventory and coverage

13-family checklist and nine findings (two V+S/seven S):
`temp/local/2026-10-27-session-recovery-redesign/AUDIT.md`; adjacent REDESIGN.md;
evidence under temp/verification/2026-10-27-session-recovery-redesign.

| Surface                             | Explicit source owners                                                                                                                                                                                                                | Audit status                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Dialog/rows/search/filter/selection | `src/app/shell/SessionRecoveryPanel.tsx`, `session-recovery.css`; `src/app/workspace/layout/WorkspaceDialogs.tsx`                                                                                                                     | Screenshot/source reviewed; actual repaired UI pending.                                                                                         |
| Rail/compact/count/local feedback   | `src/app/shell/SessionRecoveryControl.tsx`; `src/app/workspace/layout/useRecoveryControl.tsx`                                                                                                                                         | Source reviewed, alias population/cleanup discovery pending.                                                                                    |
| Recovery lifecycle/actions          | `src/app/workspace/sessions/useSessionRecoveryState.ts`, `useSessionRecoveryActions.ts`, `useOpenRecoveredSessions.ts`, `useSessionLoading.ts`                                                                                        | Source reviewed open/partial/save/dismiss/cleanup contracts.                                                                                    |
| Journal/layout/held IDs             | `src/features/workspace/model/sessionRecovery.ts`, `workspaceSnapshot.ts`, `layout.ts`; `src/app/workspace/sessions/useAutoContinue.ts`                                                                                               | Source reviewed chat-only layout, resolved/held IDs and new-work preservation.                                                                  |
| Bootstrap/detached snapshot         | `src/app/model/appLifecycle.ts`, `sessionRecoveryBootstrap.test.ts`, `sessionRecoveryDetached.test.ts`; `src/features/sessions/data/sessionStore.ts`                                                                                  | Specific source/test inventory, no real restart.                                                                                                |
| Status/identity/locks/remote        | Panel; `src/features/projects/model/projectNames.ts`; `src/features/group-lock/model/lockState.ts`; `src/features/connections/model/remoteSessionNavigation.ts`, `remoteRailSessions.ts`; `src/integrations/harness/core/registry.ts` | Fresh versus saved status, exact host/session/project identity and load guards reviewed.                                                        |
| Native persistence                  | `src-tauri/src/session_store.rs`; sessionStore                                                                                                                                                                                        | workspace_set_snapshot/get and session_get read/persistence boundary only; no native/Host runtime exercise.                                     |
| Native mobile boundary              | `mobile/src/features/connections/recovery.ts`, `recovery.test.ts`                                                                                                                                                                     | Separate connection recovery owner; no equivalent desktop global journal dialog established by route/name scan. Not physical-device acceptance. |

Reuse shared Modal/overlay, SearchInput, SegmentedControl/static Select, Checkbox,
Button, DropdownMenu/Popover, Alert and semantic themes. No recovery-local
visual controls, color recipes or new focus/Escape framework.

No dedicated recovery Host RPC is introduced. This desktop feature reads local
session_get and persists the workspace journal through workspace_set_snapshot/
workspace_get_snapshot. Remote opening uses existing connection/saved shell
identity and navigation, not arbitrary Host commands. Preserve provider binding
permissions and agent run holds. Native/mobile connection recovery differs from
reopening the desktop journal; do not collapse those authorities.

Locale sentence families: Recovered sessions, previous sessions, Needs attention,
All sessions, Open/Open all/Open selected, Restore previous layout, Clear
completed, Clear list, Remove from recovery list, Status not verified, Session
unavailable, Failed, Interrupted, Needs input, Working, Retrying, Done, Idle,
Last activity, Recovered, This computer and current error/retry strings.
Inspect en/tr overrides and real calls when changing copy.

## Owner decisions

2026-10-27, current conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`:
"Recovered SEssions bu şekilde gözüküyor bunlarıda toparlamak lazım".

Audit/design extension authorized. No new automatic opening/restart, attention
default, cleanup scope, persistence policy or native permission selected.

## Behavior to preserve

- Open is chat navigation/loading, not a new submitted turn. Removal clears/
  acknowledges journal references, not history or running work. Recovered,
  dismissed and resolved IDs remain held from automatic continuation.
- Attention means every state except Done/Idle; Working/Retrying/Unknown/
  Unavailable still qualify. Fresh matching remote state differs from saved local
  state; rejected read is not proof of missing history. Checking/read-error/
  confirmed-null/stale-remote need honest separate presentation.
- Confirmed unavailable local Open may still attempt current native load; null
  fails without fabricated shell. Only remote cwd+remoteSessionId allows exact
  saved shell reconstruction. Keep deletion/move/worktree/lock revalidation,
  existing-tab/remote alias dedup and provider context binding without restart.
- Open all/Restore target every eligible unlocked/unopened row, including search/
  filter-hidden rows. Selected actions intersect selected IDs with shown rows;
  hidden selections stay stored. Clarify these populations before changing scope.
- Restore is previous chat splits, excluding stale editor/terminal panes while
  retaining unrelated new work and eligible focus. Do not promise whole-workbench
  restoration or silently recreate terminals.
- Journal removal adds resolved IDs. Clear completed targets Done/Idle across
  all eligible rows; Clear list excludes locks. Keep serialized native snapshot
  writes, removal-save rollback and detached/main-journal ownership.
- Distinguish partial opens, already-open records, remaining failures and opened
  tabs with acknowledgment-save failure. Successful tabs are not rolled back to
  make generic error copy true. Close remains immediate; failed dismissal save
  needs honest local recovery rather than a false durable acknowledgment.
- Keep pendingRef duplicate guard, initiating-button pending state, local errors/
  retry and close-during-operation gate. Local verification concurrency4/stale
  effect cancellation remain; no new automatic scan/open/reconnect default.
- Preserve authored titles and complete project/computer/cwd/agent/model identity.
  Include visible project alias in search; coordinate generic title quality with
  workbench work rather than applying recovery-only rewriting.

## Checks and acceptance

Existing source tests: `src/app/shell/SessionRecoveryPanel.test.ts`;
`src/features/workspace/model/sessionRecovery.test.ts`, `workspaceSnapshot.test.ts`;
`src/app/workspace/sessions/useOpenRecoveredSessions.test.ts`;
`src/app/model/sessionRecoveryBootstrap.test.ts`, `sessionRecoveryDetached.test.ts`.
Inspect adjacent action/loading/auto-continue tests when changing orchestration.
Use normal tsc-rs; native/Host changes require isolated fake snapshots/sessions.

Browser owners: `tests/browser/session-recovery.tsx`, `session-recovery.html`,
`session-recovery.spec.ts`, `session-recovery.playwright.config.ts`,
`session-recovery.vite.config.ts`, `serve-session-recovery.mjs`.
Fixture explicitly navigation-only,24 fake rows/mocked callbacks. Existing scope,
narrow restore/cleanup, rail geometry and field focus checks do not prove actual
partial opens or persistence. Extend real orchestration with fake stores.

Actual dialog/rail light/dark1280/800 plus narrow/short containers, keyboard/
touch/full identity/selection/focus/reduced motion. All statuses; duplicate/long
titles and aliases; all/matching/visible-selected/hidden-selected populations;
read pending/null/error/retry; unavailable local without fabricated shell;
fresh/stale/missing remote; alias-only rail counts; mixed opens and all-opens-save
failure; dismissal failure; removal rollback; lock changes during load; current
new work versus recovered chat layout; held/resolved IDs after another restart.
Do not use real history/runs for destructive acceptance. Separate installed,
native/Host/screen-reader and physical mobile evidence.

## Proposals, blockers and handoff

Propose compact summary/search/filter, readable title/context/status, named
chat-tab opening/layout and secondary scoped list maintenance. Add full identity,
selection visibility and truthful verification/partial/save feedback. No user
guide behavior is shipped by this plan; update guides with implementation.

Card/audit/brief/concept delivered locally uncommitted at baseline above. No
product source/tests/native/Host session operation/build/install/release. Image
source inclusion UNKNOWN; build stamp absent. Actual product implementation and
theme/layout/screen-reader/native/Host/mobile acceptance pending; live feature
claims unavailable. Local concept checks are not real session recovery proof.

### Delivered count presentation sub-scope, 2026-10-27

At `main @ 0a42b1ab4`, `SessionRecoveryControl.tsx` now delegates the number to
shared `Badge variant="count" size="sm" tone="accent" appearance="subtle"`.
Both expanded and compact rail counters use the user accent and compact shared
geometry; `max={99}` preserves `99+`. Accessible full counts, journal and open/clear
operations are unchanged. This narrow repair does not mark the broader recovery
redesign above complete. Owner request/source is quoted in
`feature-sessions-sidebar/SKILL.md` under shell count badge refinement.
Focused unit/type and browser evidence: `temp/verification/2026-10-27-badges/`.
Current source is uncommitted; installed source inclusion remains unknown and
native/Host recovery lifecycle acceptance is outside this presentation sub-scope.

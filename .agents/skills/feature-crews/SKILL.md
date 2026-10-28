---
name: feature-crews
description: "bycoda Crews feature inventory: coordinator, specialist, reviewer, advisor, crew rail, work management, member library, model ratings, group copies, tasks, approvals and ambient crew scene. Read before changing any Crew surface."
---

# Crews

Reusable teams attach a coordinator conversation to specialist/advisor assignments
and independent reviewer conversations. The Host schedules work and retains run
snapshots. Search terms: crew, team, coordinator, reviewer, specialist, advisor,
member library, working settings, groups, model ratings, crew requests, work list,
crew scene, Star Wars, LOTR. The ambient scene shares the word "crew" but does not
execute a reusable team.

## Scope and ownership

Original inventory: s0 contract baseline `f26ac112404e326478adb687c23ca9cc032acfef`.
Crew audit refreshed on 2026-10-27 against dirty shared
`main @ 0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`; see the audit extension below.
That refresh includes current mobile counterparts and does not establish installed
source inclusion or a live feature reservation.
Search `rg --files` for crew filenames and `rg -n 'Crew|crew|crews\.' src host src-tauri/src tests/browser`
when updating this card; search symbols/copy keys too. Track each affected surface
below for T1/T2 acceptance. This card is an inventory, not a live ownership lock.
Check project-level feature claims and current session/workspace before writing;
coordinate a dependency or an explicit separate scope. Managed workspace APIs in
`docs/reference/managed-workspaces.md` and `host/workspace-rpc-contracts.ts` are
contracts, not evidence that a connected Host has implemented isolation.

## Surfaces

### Desktop controls and state

All paths below exist on this baseline. UI implementation tree: `src/features/crews/ui/`.

| Surface                                                                                                                                       | Source                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saved crews, show-on-rail switch, loading/error/retry, library placement                                                                      | `src/features/crews/ui/CrewsSettings.tsx`                                                                                                                                                                                                           |
| Project-rail crew list, statuses, start button, overflow, copy, duplicate, delete                                                             | `src/features/crews/ui/CrewRailSection.tsx`                                                                                                                                                                                                         |
| Sidebar grouping; management modal; Ongoing/Finished/All; work details; coordinator/worker/reviewer links; requests; pause/resume/stop/delete | `src/features/crews/ui/CrewSessions.tsx`                                                                                                                                                                                                            |
| Team, member editing/addition, Working settings, draft/conflict handling, Save/Discard/start                                                  | `src/features/crews/ui/CrewEditor.tsx`                                                                                                                                                                                                              |
| Start delivery draft and receipt reuse; saved-definition deletion dialog                                                                      | `src/features/crews/ui/CrewDialogs.tsx`                                                                                                                                                                                                             |
| Confirmed saved-definition deletion and revision binding                                                                                      | `src/features/crews/ui/CrewDeleteButton.tsx`                                                                                                                                                                                                        |
| Searchable member library, groups, scoped copies, revision conflicts and partial retry                                                        | `src/features/crews/ui/CrewLibrary.tsx`                                                                                                                                                                                                             |
| Library member search/filter/pick and explicit source-profile updates                                                                         | `src/features/crews/ui/CrewMemberPicker.tsx`                                                                                                                                                                                                        |
| Role/responsibility, instructions, fixed/automatic models, ratings, advanced fields                                                           | `src/features/crews/ui/CrewMemberForm.tsx`                                                                                                                                                                                                          |
| Shared provider/model/settings bridge; changing model resets its defaults                                                                     | `src/features/crews/ui/MemberModelPicker.tsx`; `src/features/sessions/ui/ModelPicker.tsx`                                                                                                                                                           |
| Crew icon/color popover and avatar                                                                                                            | `src/features/crews/ui/CrewAppearancePicker.tsx`; `src/features/crews/ui/CrewAvatar.tsx`                                                                                                                                                            |
| Tasks Run with / Start with crew and capability fallback                                                                                      | `src/features/crews/ui/CrewTaskPicker.tsx`; `src/features/tasks/ui/TasksView.tsx`                                                                                                                                                                   |
| App navigation, session opening, managed-session de-duplication                                                                               | `src/app/App.tsx`; `src/app/model/appUiControl.ts`; `src/app/shell/Sidebar.tsx`; `src/app/shell/ProjectRail.tsx`; `src/app/shell/SettingsRail.tsx`                                                                                                  |
| Settings navigation, section rendering, appearance preferences                                                                                | `src/features/settings/model/settings.ts`; `src/features/settings/ui/SettingsView.tsx`; `src/features/settings/ui/AppearanceSettings.tsx`; `src/features/settings/ui/AppearanceBehaviorSettings.tsx`; `src/features/projects/model/railSections.ts` |
| Onboarding crew preview, preferences and tips                                                                                                 | `src/features/onboarding/ui/OnboardingCrewPreview.tsx`; `src/features/onboarding/ui/OnboardingPreferences.tsx`; `src/features/onboarding/ui/UsageGuideTooltip.tsx`                                                                                  |

Model tree: `src/features/crews/model/` contains `crew.ts` (schema, validation,
selection/scope helpers and capability constants), `crewClient.ts` (Host query,
mutations, polling and post-error authoritative refresh), `crewDefaults.ts` (seed
roster/instructions), `crewRoster.ts` (catalog/roster helpers),
`crewPresentation.ts` (status/current review presentation), and
`crewAppearance.ts` (device-local appearance/rail persistence). Adjacent tests:
`src/features/crews/model/crew.test.ts`, `src/features/crews/model/crewClient.test.ts`,
`src/features/crews/model/crewRoster.test.ts`, `src/features/crews/model/crewPresentation.test.ts`.
Task integration also uses `src/features/tasks/model/hostTasks.ts`,
`src/features/tasks/model/taskClient.ts`, `src/features/tasks/model/taskRules.ts`
and `src/features/tasks/model/taskBulkActions.ts`.

### Ambient scene and shared word collisions

Scene entry/lazy surface: `src/features/sessions/ui/EmptySession.tsx`,
`src/features/sessions/ui/SessionPane.tsx`, `src/features/sessions/ui/crewSurface.ts`,
`src/features/sessions/ui/CrewScene.tsx`, `src/features/sessions/ui/CrewScene.css`,
`src/features/sessions/ui/CrewBackdrop.tsx`, and `src/features/sessions/model/crewActivity.ts`.

The exhaustive scene implementation family under `src/features/sessions/ui/`
includes `crewCharacters.ts`, `crewCodeArt.ts`, `crewEnvironment.ts`,
`crewLayout.ts`, `crewMotion.ts`, `crewThemes.ts`, `crewYoung.ts`,
`starWarsCrew.ts`, `starWarsLayout.ts`, `starWarsMotion.ts`, `starWarsPainter.ts`,
`starWarsRig.ts`, `lotr/lotrCrew.ts`, `lotr/lotrMotion.ts`, `lotr/lotrMotionKit.ts`,
`lotr/lotrPainter.ts`, `lotr/lotrRig.ts`, `PacingUncle.tsx`, `pacingSprite.ts`,
`pacingUncleArt.ts`, `pacingDroidArt.ts`, and `pacingEntArt.ts`.
Tracked character asset trees: `public/crew/star-wars/` and `public/crew/lotr/`.
Do not confuse context growth/theme settings with saved crew execution policies.

### Host RPC, tools, persistence and runtime

- `host/crews.ts`: HostCrews authority, saved definitions/library/run state,
  scheduling, role authorization, required capability evidence, owner directives,
  accepted review fingerprints, run events, pause/stop/recovery and deletion.
- `host/crew-defaults.ts` and `host/fixtures/crew-default-instructions.v1.json`:
  revisioned defaults; preserve edits/deletions and active snapshots.
- `host/conversation-crew-tools.ts`: paginated read projections
  `crews.definitions.list`, `crews.definition.get`, `crews.agents.list`,
  `crews.agent.get`, `crews.runs.list`.
- `host/conversation-tools.ts`: tool schemas and action permissions.
  `host/server.ts`: owner RPC and principal-bound tool dispatch/capability wiring.
- Owner RPCs: `crews.list`, `crews.schema`, `crews.inspect`, `crews.save`,
  `crews.delete`, `crews.deleteRun`, `crews.agent.save`, `crews.agent.delete`,
  `crews.start`, `crews.get`, `crews.assign`, `crews.request`, `crews.resolve`,
  `crews.respond`, `crews.answer`, `crews.pause`, `crews.stop`, `crews.resume`,
  `crews.accept`, `crews.finish`. Conversation tools expose the explicitly
  permitted subset; definition/run deletion is not an agent publishing grant.
- Capabilities in `src/features/crews/model/crew.ts`: `crews.v1`,
  `crews.tasks.v1`, `crews.delete.v1`, `crews.run-delete.v1`,
  `crews.agent-groups.v1`; catalog discovery also calls `models.list`.
- `host/tasks.ts`, `host/goals.ts`, `host/task-budgets.test.ts`:
  parent task/goal integration, task limits/reviews, retry and file-scope scheduling.
  Shared persistence/execution dependencies: `host/store.ts`, `host/engine.ts`,
  `host/sessionRuns.ts`; crew timing telemetry: `host/perf-metrics.ts`.
- Agent-facing app guidance: `host/app-skills/bycoda/SKILL.md`,
  `host/app-skills/bycoda/references/work.md`,
  `host/app-skills/bycoda/references/workspace.md`.

### Native, mobile and locales

- Native bridge: `src-tauri/src/remote.rs` allows the exact crew RPC methods;
  there is no separate Crew Rust feature module. Keep native and Host authorization
  aligned; regression coverage is in `src/features/connections/model/remoteMethodAllowlist.test.ts`.
- The original s0 snapshot lacked mobile sources. Current 2026-10-27 inventory
  includes `mobile/src/features/management/index.tsx` routing CrewsScreen from
  `mobile/src/features/management/crews-screen.tsx`. Counterparts under
  `mobile/src/features/management/crews/`: `crew-editor.tsx`, `member-editor.tsx`,
  `profile-editor.tsx`, `start-editor.tsx`, `runtime-panel.tsx`, `run-card.tsx`,
  `assignment-editor.tsx`, `member-inspection.tsx`, `model.ts`, `runtime-model.ts`
  and `presentation.ts`, with adjacent tests. Bridge/contracts:
  `mobile/src/remote/services/crews-api.ts` and
  `mobile/src/remote/contracts/crews.ts`. This is a partial current source
  inventory, not a full mobile redesign or physical-device acceptance.
- Translation catalogs: `src/shared/i18n/locales/` (`en.json`, `tr.json`,
  `de.json`, `es.json`, `fr.json`, `ja.json`, `pt.json`, `zh-CN.json`),
  `src/shared/i18n/en-overrides.json`, `src/shared/i18n/tr-overrides.json`.
  Keys are English source strings rather than a `crews.*` namespace. Families:
  `Crew`, `Crews`, `Crew name`, `Crew work`, `Crew work view`, `Crew view`,
  `Crew icon`, `Crew icon and color`, `Crew theme`, `Member`, `Member library`,
  `Member group`, `Model ratings`, `Automatic model choice`, `Coordinator`,
  `Responsibility in the crew`, `Start crew work`, `Delete crew`, `Delete work`,
  `Working settings`, `Team ({p0})`, `Ongoing ({p0})`, `Needs decision:` and
  role/instruction/model/limit/permission copy consumed by the components above.
  Search actual `t(...)` calls before translating; stale catalog keys are not UI proof.

### Browser and acceptance inventory

- Crew UI fixture: `tests/browser/crews.tsx`, `tests/browser/crews.html`,
  `tests/browser/crews.spec.ts`, `tests/browser/playwright.crews.config.ts`,
  `tests/browser/vite.crews.config.ts`, `tests/browser/serve-crews.mjs` (1491).
- Ambient scene fixture: `tests/browser/crew-scene.tsx`,
  `tests/browser/crew-scene.html`, `tests/browser/crew-scene.spec.ts`,
  `tests/browser/star-wars-crew.spec.ts`, `tests/browser/playwright.crew.config.ts`,
  `tests/browser/vite.crew.config.ts`, `tests/browser/serve-crew.mjs` (1453).
- Adjacent integration fixtures/specs: `tests/browser/tasks.spec.ts`,
  `tests/browser/composer-extras.tsx`, `tests/browser/composer-extras.spec.ts`,
  `tests/browser/compact-navigation.tsx`, `tests/browser/onboarding.spec.ts`;
  fixture configuration also touches `tests/browser/vite.composer.config.ts`
  and `tests/browser/warm-dev-server.ts`.
- Host suites: `host/crews.test.ts`, `host/crew-lifecycle.test.ts`,
  `host/crew-defaults.test.ts`, `host/crews.perf.test.ts`,
  `host/conversation-tools.test.ts`, `host/server.test.ts`.
- Scene suites: `src/features/sessions/model/crewActivity.test.ts`,
  `src/features/sessions/ui/CrewScene.test.ts`,
  `src/features/sessions/ui/CrewScene.perf.test.ts`,
  `src/features/sessions/ui/CrewBackdrop.test.ts`,
  `src/features/sessions/ui/crewCodeArt.test.ts`,
  `src/features/sessions/ui/crewLayout.test.ts`,
  `src/features/sessions/ui/crewMotion.test.ts`,
  `src/features/sessions/ui/starWarsCrew.test.ts`,
  `src/features/sessions/ui/starWarsMotion.test.ts`,
  `src/features/sessions/ui/lotr/lotrMotion.test.ts`,
  `src/features/sessions/ui/pacingUncleArt.test.ts`,
  `src/features/sessions/ui/EmptySession.test.ts`.
- Navigation/settings/task regression suites:
  `src/app/shell/SidebarRename.test.ts`,
  `src/features/projects/model/railSections.test.ts`,
  `src/features/settings/model/settings.test.ts`,
  `src/features/settings/model/settings.flags.test.ts`,
  `src/features/settings/model/sharedPreferences.test.ts`,
  `src/features/settings/ui/SettingsView.test.ts`,
  `src/features/onboarding/ui/OnboardingDialog.test.ts`,
  `src/features/tasks/model/hostTasks.test.ts`,
  `src/features/tasks/model/taskClient.test.ts`, `host/app-skills.test.ts`.

## Local lead-run worker branch delivery (F1)

The local orchestration adapter is a separate entry point from saved Host Crews.
`src/features/orchestration/model/orchestration.ts` supplies worker/lead envelopes;
`orchestrationState.ts` retains `managedWorkspaceId` with each worker checkout.
`src/app/workspace/bridges/orchestratorWorkerBindings.ts` creates new isolated
workers through `workspaces.prepare`, persists the session-owned registry identity,
and accepts their committed results only after owner-approved managed merge. A
fresh delivery review must show no pending commits or blockers; a stale `merged`
state is insufficient. The adapter never copies checkpoints as delivery.

Workers commit only their assigned files on their own branches. The owner reviews
and merges from the worker session's Workspace actions; the coordinator then retries
review. Cleanup uses the shared managed lifecycle and retains branches. Retained
legacy workers remain outside automatic adoption and require explicit owner
migration before managed acceptance. Existing shared legacy runs retain their
current-mode behavior.

Focused evidence: `orchestratorWorkerBindings.test.ts` covers managed creation,
pending delivery, fresh merge acceptance, drift and guarded cleanup;
`src/features/orchestration/model/orchestration.test.ts` covers assignment and
coordinator behavior. This is source/fixture evidence; installed app and real
provider execution remain separate checks.

## Owner decisions

2026-10-27, owner conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`:

> Crew ekranıda bu şekilde gördüğün gibi butonların sollarındaki ikonlar bile gözükmüyor şuanda. Buralarında kullanımını tasarımını ui ux ini geliştirip düzenlenmesi için audit oluşturalım

Clarification covering both member role/agent icons and action-button icons:

> Her iki alan

These select audit scope only. No new run/model/cost/permission default or actual
start/resume operation was selected. Composition ideas below remain proposals.

## Behavior to preserve

Keep every role and instruction, searchable fixed/custom model choice, independent
model settings, automatic candidate ratings, explicit profile updates, scope,
groups, defaults tombstones and current run snapshots. Keep draft separation and
conflict recovery. Appearance stays device-local. Use existing shared controls,
semantic tokens and overlay routing. Preserve capability-gated deletion, confirmed
stop/delete, revision checks, durable request IDs, unknown-outcome reconciliation,
current reviewer identity, task dependencies/file leases, required checks and
independent acceptance. Crew acceptance is not delivery or publication approval.

## Checks and visual scenarios

Choose focused checks according to changed behavior, using the repository-pinned
pnpm. Examples:

- `pnpm vitest run src/features/crews/model/crew.test.ts src/features/crews/model/crewClient.test.ts src/features/crews/model/crewRoster.test.ts src/features/crews/model/crewPresentation.test.ts`
- `pnpm test:host -- host/crews.test.ts host/crew-lifecycle.test.ts host/crew-defaults.test.ts host/conversation-tools.test.ts`
- `pnpm exec playwright test --config tests/browser/playwright.crews.config.ts`
- `pnpm exec playwright test --config tests/browser/playwright.crew.config.ts`

For changed UI, inspect screenshots at 1280 and 800 widths, light/dark, opened and
reviewed under `temp/verification/<id>/`. Exercise rail empty/multiple/long-name
states; Team/member/add/library/settings; scope copies; search/group updates;
fixed/automatic model and catalog failure; retained/conflicting drafts;
capability/permission rejection; pending/error/retry; start/open uncertain outcome;
ongoing/finished/deleted-definition work; current reviewer; requests/blocked work;
pause/resume/stop/delete confirmations. Cover keyboard focus, popovers, Escape,
narrow wrapping, reduced motion and scene themes when affected. Check build status
and identity before classifying an owner screenshot as a new defect. Fixture
results prove fixture behavior; exercise isolated native/dev-Host integration
separately and report installed, device and released evidence independently.

## Known concrete blockers

The original baseline lacked mobile sources; the current mobile inventory above
supersedes that absence. Live feature-claim APIs were unavailable in the audit;
available Git/worktree/native session state was inspected, with no cross-machine
reservation asserted. Host capability contracts do not
prove the owner's running Host implements the new workspace model. No installed
app, live provider, physical device or crew execution is exercised by this card.
Do not start a fixture if its fixed port belongs to another session; report the
port conflict and preserve that process.

## Committed handoffs

- Inventory baseline: `f26ac112404e326478adb687c23ca9cc032acfef` (s0 contracts).
- User guide: `docs/guides/crews.md`.
- F2: `877eef8d` pins each local worker's selected lead SHA, branch and directory
  through managed preparation, retries and delivery acceptance.
  `src/app/workspace/bridges/orchestratorWorkerBindings.ts`,
  `src/features/orchestration/model/orchestrationState.ts`,
  `host/workspace-rpc-contracts.ts` and `host/managed-workspaces.ts` own this flow.
  Missing targets fail; owner approval remains required, and delivery to a
  different integration branch cannot satisfy acceptance.
- `6f8d3f7b` adds actual Git/SQLite/Host service regressions in
  `host/managed-workspaces-crew.test.ts` and
  `src/app/workspace/bridges/orchestratorWorkerBindings.realGit.test.ts`.
  These cover the lead-only prerequisite, owner gate, correct delivery and
  wrong-target rejection. Frontend orchestration/binding/Crew model checks pass
  124 tests. Existing orchestration Playwright cases fail at their unchanged
  assignment-model search locator; a baseline `a5590217` source run reproduces it.
  This is source/service evidence, separate from installed or live Crew acceptance.

## Proposals

The 2026-10-27 audit proposes compact task-based Team/Working settings/Work
composition, truthful model and run context, retained nested drafts/selections
and deliberate member/action icon presentation. This is design work only;
implementation and actual rendered acceptance remain pending.

## Crew UI/UX audit extension, 2026-10-27

T2 audit/design scope: six supplied light captures, 20 surface/state families.
Three native read-only reviews cover editor/members, settings/models and work
lifecycle; parent verified source contracts/icon path and all six captures.
Register: `temp/local/2026-10-27-crews-redesign/AUDIT.md` (18 records: five V+S,
13 source-only, not 18 reproduced bugs). Composition/repair order and full
preservation/acceptance ledger: `REDESIGN.md` in the same directory. Evidence:
`temp/verification/2026-10-27-crews-redesign/EVIDENCE.md`.

- Member rows do not render a left identity icon (`CrewEditor.tsx:573`); some
  action glyphs are visible in the owner captures. Current direct Lucide wrapper
  emits eight nonempty tested Crew SVGs and shared icon/Button tests pass six
  cases. This does not establish CSS/layout/contrast or installed action-icon
  visibility. Check actual loaded source/theme/state before assigning a cause.
- Distinguish free member name/professional role from structural responsibility,
  fixed model from automatic candidate pool, selected identities from hidden
  filtered picks and Crew copies from reusable library profiles. Retain Add
  member subform drafts, all candidate settings and explicit profile writes.
- Settings described as automatic-only also constrain fixed models. The same
  maxEstimatedCost property filters per-model relative ratings and reduces
  accumulated worker/reviewer estimate budget. Resolve semantics/units before
  implementation; do not imply currency or relax guards through restyling.
- Existing appearance saves immediately/device-locally outside Discard. Keep
  limits, bulk Apply, custom ranking, scope copies, revisions/conflicts, owner
  grants and concise visible permission consequences.
- Saved team/count/Edit context and frozen run team must be distinct. Paused
  execution does not remove unresolved decisions/blockers. Keep direct request
  and session controls, current reviewer routing and selection through polling.
- UI full-request expectation exceeds real list/get serialization; inspect is
  not a full-request alternative. Fixture launch content is not Host proof.
  Preserve sanitized lists and privacy; add deliberate bounded detail/completeness
  contracts if required. Keep uncertain start receipts, partial Stop, separate
  open/resume, deletion guards, work history and managed delivery boundaries.

Audit only: no product/UI/Host/native/mobile edits or live operations. Actual
Crew light/dark 1280/800/narrow, accessibility, isolated Host/native, installed
icon visibility and physical mobile checks are pending. Concept/SSR/unit evidence
cannot close those acceptance items. The ambient scene is separately inventoried
and is not redesigned from these six captures. No build/install/release performed.

## Settings collections and library-profile extension, 2026-10-27

Exact owner quote, conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`:

> crew ayarları bu şekilde gözüküyor aşağı doğru uzuyor actionlar çok sağda kalıyor ekran geniş olduğununda burayı daha güzel yönetebiliriz diye düşünüyorum.

T2 audit/design at the same dirty main baseline, three new light Settings captures
K01–K03 opened; installed source inclusion UNKNOWN. Two native read-only reviews
plus parent source/layout checks.10 Settings-specific records (three V+S,seven S),
13 families. Prior18 records/20 families remain dependencies; no simple summed
reproduced-bug total. Live claim API unavailable, card remains not a lock. Preserve
concurrent staged/unstaged source and shared controls, no index/branch operation.

Register/repair: `temp/local/2026-10-27-settings-crews-audit/AUDIT.md` and
REDESIGN.md. Evidence:
`temp/verification/2026-10-27-settings-crews-audit/EVIDENCE.md`.
Settings/workbench cards and main plan R link here; no duplicate feature card.

### Settings-focused inventory and findings

- `src/features/crews/ui/CrewsSettings.tsx`: rail preference, saved definitions,
  scope/count, create/edit/work management. Empty/~ cwd disables hook reads but
  can look permanently loading; retained-data refresh error is hidden. Work/open
  management is separate from Edit and actual execution.
- `src/features/crews/ui/CrewLibrary.tsx`: search/groups/collection, GroupDialog
  and LibraryMemberDialog; profile draft/model validation/save/copy/delete/conflict.
  Group rename/delete changes labels, not members; partial retries refetch remaining
  profiles. Profile dirty close is distinct from prior CR-E01 Add-member draft.
- `src/features/crews/ui/CrewMemberForm.tsx`, `MemberModelPicker.tsx` and
  `src/features/crews/model/crewRoster.ts`: full instructions/name/responsibility,
  group entry, fixed/automatic pool and independent library-to-crew update offers.
- `src/features/crews/model/crewClient.ts`: project-scoped crews.list with progressive
  models.list, capability/query-target gates and retained data/polling. Preserve
  opening existing work if only model discovery fails.
- `src/features/crews/model/crewAppearance.ts`: Show crews is device-local rail
  visibility, not a run switch. Its swallowed write errors need local recovery.
- `src/features/settings/ui/settingsControls.tsx`, `BycodaSettings.css`: generic
  full-width Rows separate labels/actions too far. Controls already have labelled
  group context; repeated Edit labels are not wholly inaccessible. Scope/count in
  descriptions can become compact inline facts without deleting help.
- Host `host/crews.ts`: profile save compares expectedUpdatedAt/scope; delete
  currently owner/scope checks only. Current delete stale-edit behavior requires a
  deliberate concurrency decision/test before claiming revision protection.
  Exact RPCs crews.list/agent.save/agent.delete, models.list; existing crews.v1,
  crews.agent-groups.v1 and native remote allowlist remain authoritative.
- Mobile `mobile/src/features/management/crews/profile-editor.tsx` and
  `member-editor.tsx`: existing dirty/pending useSheetGuard is a parity reference,
  not desktop proof. Broader native/Host/mobile inventory above remains in force.

Propose stable compact Crew/library collection views with bounded reading/action
tracks, near-row frequent actions, direct search and focused editor. Prefer these
over nested accordions. Keep all fields/groups/model candidates and useful
scope/count, avoid introducing network paging for already-loaded rows.

Repair profile dirty close, empty-pool Save with no visible error, revision-conflict
recovery, stale-delete semantics, retained-data refresh/error and disabled-context
state. Keep draft/error and pending gates, confirmation/owner/scope checks, stable
copy retry identity and uncertain-save refetch/receipt matching. No blind overwrites
or automatic model substitution. Library original → crew copy → running snapshot
remains explicit; editing/deleting a profile does not mutate running work/history.

Prior CR-E03 fixed/Automatic summary, CR-E04 name/responsibility, CR-E06 search
coverage, CR-E02/CR-S01 density and CR-S04 appearance/Discard semantics carry over
without recounting. Previous icon/runtime/permission/budget/request findings remain
pending in their own scope, not fixed by these Settings screenshots.

### Settings checks and handoff

19 existing tests/four files pass once: crewClient, crewRoster, crewPresentation,
crew allocation. Static four-file scan[]. Source tests are not new compact UI,
profile modal, stale/conflict/delete or installed/native acceptance. Prior icon/
SSR checks were not repeated. Browser crews.spec.ts includes Settings work-open,
partial group retry and uncertain copy fixtures; read, not run this extension.

Required repair: actual light/dark1280/800/narrow, long names/groups/zoom,
keyboard/reader/reduced motion; collection context/stale/filter-empty and rail
write error; dirty-close, missing model/name, conflict recovery, fresh-delete
decision, copy receipt/group retries and frozen-snapshot independence. Isolated
Host/native and mobile device checks remain separate. Update guides after actual
behavior changes. Audit ready for review; no source/profile/preference/model/run/
Host write, build/install/release, index/branch change or commit delivered.

Inventory delivery: `4454ce32` on `bycoda/wt-model/s7` commits this code-backed
card and the worktree-first documentation. This reference establishes inventory
delivery only; product/runtime acceptance remains as described above.

## Host HTTP/WS source integration, 2026-10-28

The paired-owner Crew RPCs now share `host/domains/crews/service.ts`, the existing
`HostCrews` owner and 20 closed schemas in
`src/shared/model/host-contracts/crews.ts`. Schema artifact `3a32bdd78645` has
131 methods overall; `transport.ws.crews.v2` advertises only this routed cohort.
No wire/schema version, local execution default or migration gate was promoted.

Preserve all 20 branches, including stateful default-bootstrapping `list`, optional
definition revision versus required run-deletion revision, raw mutation results
versus redacted read views, library scope and snapshots retained after deletion.
Paired calls pass no conversation principal; scoped tools keep their native
binding. Never obtain a principal from payload fields. Accepted create/send IDs
survive late revocation through owned SQL-only recovery with concurrent pause,
Stop and configuration edits preserved. Caller cancellation does not own already
accepted child work. Existing request fingerprints are not rewritten.

Image-capability inspection may prepare a real native app-server. Its authority
checks follow asynchronous setup and the actual headless spawn; the optional
in-process restriction is never serialized into Tauri/JSON. Cache only completed
public evidence and serialize waiting probes without sharing a caller's failed
grant. No image generation or social publishing was authorized by this change.

Source/fixture evidence is under
`temp/verification/2026-10-28-crew-authority/`,
`temp/local/2026-10-28-crews-review/` and
`temp/verification/2026-10-28-crews-native-mobile-contract/`.
Current native broker52/remote47, mobile47 and normal compiler checks are source
evidence; they do not establish installed, actual-provider or device acceptance.
The complete Host/runtime ledger owns remaining migration and parity gates.

## Appearance ambient-crew dependency, 2026-10-27

`temp/local/2026-10-27-settings-appearance-audit/` covers Appearance's decorative
Agent crew master/theme/context growth. It is separate from saved executable
Crews/member library/task management. Preserve three visual themes, theme-specific
aging/color meaning, disabled stored choices, same/sibling updates, unknown/
compacted context and paused/still scene behavior. No executable crew/profile/
model or ambient preference was changed. See feature-appearance for inventory,
proposal and native/rendering acceptance; fresh153 Appearance tests do not prove
all crew-scene/Host/device journeys.

## Redesign implementation, 2026-10-28 (H2-2, uncommitted)

Shared checkout `main @ c03fa98d4`, uncommitted, no build. Not tested by owner
rule (2026-10-28, RULES.md): "test yapmasınlar en iyisi kodları yazsınlar en son
testi biz yaparız". Only `tsc-rs --noEmit --fast` ran (exit 0). Package:
`temp/local/2026-10-28-crews-impl/` (handoff, writer reports, review).

Delivered behavior (source only):
- Team: roster grouped by responsibility with counts, name-first rows with
  `CrewRoleIcon` + responsibility label + `memberModelSummary`; Remove is an
  `InlineAction` in `ActionHost`. Unfinished picks/new-member draft survive Back
  and filter changes (picks keep the slot role they were made in) until Add,
  **Discard draft** or crew Discard. "Member name" field; groups editable on new
  members independently of library save (CR-I01, CR-E01–E05, CR-E07).
- Working settings: `CrewWorkingSettings.tsx` compact sections (eligibility for
  every member with affected members via `crewPolicyImpact`, ranking, bulk fixed
  Apply with count, limits, visible permission consequences, device-local
  appearance note). Enforcement and persisted fields unchanged (CR-S01–S05).
- Library/picker/rail/settings list: search over visible row text plus
  instructions (`CrewLibrarySearch.ts`, scope excluded), picked chips with hidden
  count and clear routes, rail attention ranking separate from execution with
  Start visible at rest (CR-E03, CR-E06, CR-E07, CR-W04, CR-I01).
- Work: `CrewWorkList/Detail/Sessions/State.tsx`: search, timestamps, execution
  versus attention badges, "This work's team" snapshot versus saved team,
  run-recorded member/model rows, honest first-line request notice (CR-W01–W05).

Open: Host owner-scoped request detail read (CR-W01), cost unit/two meanings
owner decision (CR-S03), installed action-icon visibility reproduction (CR-I01),
roster search (CR-E02), compact shared settings Group/Row variant (H3), browser
fixture variant without `launch`. Browser selectors in `tests/browser/crews.spec.ts`
were updated for the new labels but not run.

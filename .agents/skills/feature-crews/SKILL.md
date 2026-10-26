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

Enumerated from source on the s0 contract baseline `f26ac112404e326478adb687c23ca9cc032acfef`.
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
- No `mobile/` tree or Crew mobile screen exists in this frozen checkout. This is
  an explicit inventory gap, not a guessed path or a physical-device acceptance.
  Re-search the integration checkout when mobile sources are available.
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

## Owner decisions

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

The frozen baseline contains no mobile sources. Host capability contracts do not
prove the owner's running Host implements the new workspace model. No installed
app, live provider, physical device or crew execution is exercised by this card.
Do not start a fixture if its fixed port belongs to another session; report the
port conflict and preserve that process.

## Committed handoffs

- Inventory baseline: `f26ac112404e326478adb687c23ca9cc032acfef` (s0 contracts).
- User guide: `docs/guides/crews.md`.
- Update this section with the actual implementation commit and checks when a
  future crew change is committed; do not record an uncommitted result as delivered.

## Proposals

No additional product changes are proposed by this inventory.

Inventory delivery: `4454ce32` on `bycoda/wt-model/s7` commits this code-backed
card and the worktree-first documentation. This reference establishes inventory
delivery only; product/runtime acceptance remains as described above.

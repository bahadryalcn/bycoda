# Crew surface map

Paths are repository-root relative. Basenames in a named directory are relative to that directory.

## UI, state and adjacent consumers

- `src/features/crews/ui/`: `CrewsSettings.tsx`, `CrewRailSection.tsx`, `CrewSessions.tsx`, `CrewEditor.tsx`, `CrewDialogs.tsx`, `CrewDeleteButton.tsx`, `CrewLibrary.tsx`, `CrewMemberPicker.tsx`, `CrewMemberForm.tsx`, `MemberModelPicker.tsx`, `CrewTaskPicker.tsx`.
- Work details: `CrewWorkList.tsx`, `CrewWorkDetail.tsx`, `CrewWorkSessions.tsx`, `CrewWorkState.tsx`; shared working choices: `CrewWorkingSettings.tsx`. Search library uses `CrewLibrarySearch.ts`; appearance uses `CrewAppearancePicker.tsx` and `CrewAvatar.tsx`.
- `src/features/crews/model/`: `crew.ts` schema/capabilities, `crewClient.ts` queries/mutations/reconciliation, `crewDefaults.ts` seeded profiles, `crewRoster.ts`, `crewPresentation.ts`, `crewAppearance.ts`.
- Follow callers in `src/app/App.tsx`, `src/app/shell/Sidebar.tsx`, `ProjectRail.tsx`, `SettingsRail.tsx`, settings navigation, `src/features/tasks/` and onboarding. Shared model choices use `src/features/sessions/ui/ModelPicker.tsx`.
- Ambient scene is separate from orchestration: `src/features/sessions/ui/CrewScene.tsx`, `CrewBackdrop.tsx`, `crewSurface.ts`, `EmptySession.tsx`, `SessionPane.tsx`; `src/features/sessions/model/crewActivity.ts`. Search related scene/art modules rather than matching every use of the word crew as a scheduler operation.

## Runtime, persistence and platform

- Search `host/crews/crews.ts`, Crew lifecycle/default modules and `host/conversation/conversation-tools.ts` for the actual operation, request/revision checks, paired-owner service and conversation principal. Domain HTTP/WS wiring is documented in repository-root `docs/reference/host-runtime.md`.
- Coordinator identity/status reads cross `host/server.ts` metadata composition and `host/desktop/desktopSessions.ts`. Command effects cross `host/domains/commands/service.ts`, `host/desktop/desktopLive.ts` and `host/desktop/desktop-command-delivery.ts`; retain the existing native/Host ownership and receipt boundaries.
- Task integration uses `src/features/tasks/model/hostTasks.ts`, `taskClient.ts`, `taskRules.ts`, `taskBulkActions.ts` in that directory; managed execution/delivery belongs to repository-root `docs/reference/managed-workspaces.md`.
- Search `src-tauri/src/` adapters and `mobile/` Crew counterparts only for the changed boundary. Do not infer their availability from desktop source.
- Locales live in `src/shared/i18n/locales/` and override catalogs; preserve role, model-rule, current-team, request and pending action copy.

## Focused verification

Adjacent model suites include `crew.test.ts`, `crewClient.test.ts`, `crewRoster.test.ts`, `crewPresentation.test.ts`; Host suites include `host/crews/crews.test.ts`, `host/crews/crew-lifecycle.test.ts`, `host/crews/crew-defaults.test.ts`, `host/crews/crew-native-session.test.ts`. Browser entry points include `tests/browser/crews.spec.ts`, `playwright.crews.config.ts` and the separate crew scene family. Select the appropriate family; a scene render does not prove orchestration.

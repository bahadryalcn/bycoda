# Appearance surfaces

Code paths are repository-relative. Verify current callers and platform gates for the edited capability.

## Ownership

| Area                                  | Starting points                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preferences and preview               | `src/features/settings/ui/AppearanceSettings.tsx`, `AppearanceSettings.css`, `AppearancePreviews.tsx`, `AppearancePreviews.css`, `useAppearanceSettings.tsx`           |
| Preference state and durable outcomes | `src/features/settings/model/appearance.ts`, `appearancePreferences.ts`, `appearancePersistence.ts`, `uiScale.ts`, `themePalettes.ts`                                  |
| Motion/session display                | `src/features/settings/ui/AppearanceBehaviorSettings.tsx`, `SessionListSettings.tsx`; model `decorativeMotion.ts`; `src/features/sessions/model/sessionListDisplay.ts` |
| Global image effects                  | `src/features/settings/model/newThreadBackgroundEffects.ts`, `newThreadBackgroundEffects.worker.ts`; follow image controls and SessionPane consumers                   |
| Project image precedence              | `src/features/projects/model/chatBackground.ts`, `projectChatBackground.ts`; `src/features/projects/ui/ProjectBackgroundDialog.tsx`, `useProjectBackgroundEffect.ts`   |
| Live scenes                           | `src/features/settings/ui/LiveBackgroundPicker.tsx`, `LiveBackgroundCanvas.tsx`, `live-background/`; `src/features/settings/model/liveBackground.ts`                   |
| Shared theme                          | `src/shared/theme/palette.ts`, `src/styles/palette.css`, `index.css`, `arc.css`; use existing theme references                                                         |
| Navigation/ambient consumers          | `src/app/shell/Sidebar.tsx`, `ProjectRail.tsx`; `src/features/sessions/ui/CrewScene.tsx`, `CrewBackdrop.tsx`; follow current tab-motion consumer                       |

## Persistence and platform boundaries

- Appearance record: `bycoda.appearancePreferences.v1`; verify normalization/defaults before adding a field. `canvasBackground`, accent readability, custom surfaces and reset scopes are independent contracts.
- Native commands: `set_window_glass_enabled` in `src-tauri/src/window.rs`; `set_window_background_blur` and registrations in `src-tauri/src/lib.rs`. Never infer effective OS state from renderer CSS.
- Image commands in `src-tauri/src/chat_background.rs`: `save_chat_background`, `remove_chat_background`, `save_project_chat_background`, `remove_project_chat_background`. Preserve existing size/extension validation and failure ownership.
- Mobile: `mobile/src/state/appearance.ts`, `chat-appearance.ts`, `mobile/src/ui/theme.ts`, `mobile/src/features/settings/`. Desktop glass/font/zoom settings do not grant phone or remote Host authority.
- Search source messages and reveal IDs for Mode/palette/accent, Background tone, typography, Layout, Translucency, Backgrounds and Motion; preserve IDs when simplifying copy.

## Focused checks

Use colocated tests beside `appearance`, `appearancePreferences`, `nativeGlass`, `uiScale`, `appearancePersistence`, `decorativeMotion`, image-effect workers, `useAppearanceSettings`, picker/canvas and session-list display as relevant. Browser entry points are `tests/browser/settings.e2e.ts`, `settings-layout.e2e.ts` and `live-backgrounds.e2e.ts`; inspect their configs before launching.

Check write failure/retry/sibling races, scoped reset, image decode/worker failure, platform disabled reasons and real consumers of changed accent roles. Native glass/font/GPU/terminal/device checks require the actual boundary; fixture success is insufficient.

## Unresolved reference disagreement

`docs/reference/ui-design-system.md`, "Appearance as the design-system editor", says advanced preferences should remain visible without disclosure. Its "Settings row contract" describes closed Advanced rows, and the prior Appearance card describes custom colors behind a closed Advanced row. Preserve reachability and reveal behavior; reconcile the owning design decision before changing visibility. This record neither selects a new default nor authorizes a product change.

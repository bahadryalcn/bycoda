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

- Custom image/video/HTML backgrounds: `src/features/settings/ui/ChatBackgroundMedia.tsx`, `src/features/settings/model/backgroundHistory.ts`, `src/features/settings/model/backgroundControl.ts` and `src-tauri/src/chat_background/preview.rs`. The [workbench guide](../../../../docs/guides/workbench.md) covers limits and ordinary conversation tools. Preserve image-only effects, immutable selections and the offline nested sandbox.

- Workspace gradients: `src/features/settings/ui/GradientBackgroundCard.tsx` and its module CSS; `src/features/settings/model/workspaceBackground.ts` owns `bycoda.workspaceBackground.v1`, normalization, same-/sibling-window updates and save/conflict recovery. The pure serializer/presets are `src/shared/theme/workspaceBackground.ts`; `src/styles/index.css` owns the single root image, theme veil and accessibility fallback. `initAppearance()` initializes it for main/detached workspaces; independent quick composer keeps its own background contract. Model/UI tests are colocated; browser scenarios are in `tests/browser/settings/settings.e2e.ts`.

- Appearance record: `bycoda.appearancePreferences.v1`; verify normalization/defaults before adding a field. `canvasBackground`, accent readability, custom surfaces and reset scopes are independent contracts.
- Native commands: `set_window_glass_enabled` in `src-tauri/src/window.rs`; `set_window_background_blur` and registrations in `src-tauri/src/lib.rs`. Never infer effective OS state from renderer CSS.
- Image commands in `src-tauri/src/chat_background.rs`: `save_chat_background`, `remove_chat_background`, `save_project_chat_background`, `remove_project_chat_background`. Preserve existing size/extension validation and failure ownership. Library commands (`list_/add_/delete_background_library_image`) live in `chat_background_library.rs`; they reuse `validate_background_file`, and the library lives under `backgrounds/library/` (cap 60 images / 400 MB, oldest unprotected evicted first).
- Mobile: `mobile/src/state/appearance.ts`, `chat-appearance.ts`, `mobile/src/ui/theme.ts`, `mobile/src/features/settings/`. Desktop glass/font/zoom settings do not grant phone or remote Host authority.
- Search source messages and reveal IDs for Mode/palette/accent, Background tone, typography, Layout, Translucency, Backgrounds and Motion; preserve IDs when simplifying copy.

## Focused checks

Use colocated tests beside `appearance`, `appearancePreferences`, `nativeGlass`, `uiScale`, `appearancePersistence`, `decorativeMotion`, image-effect workers, `useAppearanceSettings`, picker/canvas and session-list display as relevant. Browser entry points are `tests/browser/settings/settings.e2e.ts`, `settings-layout.e2e.ts` and `live-backgrounds.e2e.ts`; inspect their configs before launching.

Check write failure/retry/sibling races, scoped reset, image decode/worker failure, platform disabled reasons and real consumers of changed accent roles. Native glass/font/GPU/terminal/device checks require the actual boundary; fixture success is insufficient.

## Unresolved reference disagreement

`docs/reference/ui-design-system.md`, "Appearance as the design-system editor", says advanced preferences should remain visible without disclosure. Its "Settings row contract" describes closed Advanced rows, and the prior Appearance card describes custom colors behind a closed Advanced row. Preserve reachability and reveal behavior; reconcile the owning design decision before changing visibility. This record neither selects a new default nor authorizes a product change.

## Saved themes and image library

- Every applied chat background image is also kept in the library (`model/backgroundLibrary.ts`, `controls/BackgroundLibrary.tsx`). Saved themes (`model/savedThemes.ts`, `model/appearanceSnapshot.ts`, `controls/savedThemeActions.ts`, `SavedThemes.tsx`, `SaveLookButton.tsx`) store a snapshot of every setting plus a library image id.
- A new Appearance setting must join `captureAppearanceSnapshot`, `normalizeAppearanceSnapshot` and `applyAppearanceSnapshot`, or saved themes will not restore it.
- Library media referenced by saved themes/designs are never evicted or deleted by the media picker; delete the named design first.
- Creation entry points use `controls/DesignStudio.tsx`, `runtime/createDesign.ts` and `runtime/savedDesigns.ts`. Named designs extend the existing saved-theme store with creation metadata; do not add another preference store. Portable artifacts cross the native `chat_background/design.rs` boundary and never apply on import. See the workbench guide for the user flow and limits.
- Ordinary Library/history/current-selection names use `model/backgroundNames.ts`, `runtime/nameBackground.ts` and `controls/SaveBackgroundButton.tsx`. Reuse the same saved-design name and immutable media id. Legacy path aliases are bounded label metadata only, removed when replacing the media and excluded from portable exports. Failed catalog writes do not publish names before storage succeeds.

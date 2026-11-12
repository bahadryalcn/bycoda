---
name: feature-appearance
description: "Use when changing Appearance settings: theme, accent and background pickers, previews and native glass. Not for shared color roles; see feature-theme-foundation."
---

# Appearance development

Use for Appearance controls, durable preference outcomes, live previews, global/project backgrounds and motion/ambient choices. Shared CSS role changes also need [theme foundation](../feature-theme-foundation/SKILL.md); voice and executable Crews are separate features.

## Source starts

- `src/features/settings/ui/AppearanceSettings.tsx` composes the tabs in `ui/appearance/sections/`; custom controls live in `ui/appearance/controls/`. `AppearancePreviews.tsx` and `useAppearanceSettings.tsx` own previews and the controller. `model/interactionTint.ts` owns hover/selection tint; search entries live in `model/appearanceSettingsIndex.ts`.
- `src/features/settings/model/appearance.ts`, `appearancePreferences.ts` and `appearancePersistence.ts` own application, normalization and durable receipts.
- `src/features/settings/ui/appearance/controls/`: theme generation and image controls. The sticky generator spans tabs and uses existing setters; tint/accent always apply, optional groups only when present.
- `src/features/settings/model/themeSuggestionFields.ts`: AI field specs and accessibility guards, with bounds from `themeRanges.ts`; the Host prompt derives from these specs.
- `host/appearance/theme-suggestions.ts`: Host command `appearance.themeSuggestions` (contract in `src/shared/model/host-contracts/appearance.ts`); it validates and clamps every entry before it returns.
- `host/appearance/background-image.ts`: Host command `appearance.backgroundImage`. It reuses the Social image adapters (Codex native ImageGen, or Gemini when the Host has `GEMINI_API_KEY` and `BYCODA_SOCIAL_GEMINI_IMAGE_MODEL`), tries only the chosen provider, and returns a temporary file the desktop copies through `onChooseChatBackground`.
- `src/features/settings/model/workspaceBackground.ts` and `src/shared/theme/workspaceBackground.ts`: separate artwork persistence and safe serialization; shared CSS paints it once without native glass.
- Read [surfaces](references/surfaces.md) only for the affected background/native/platform/saved-theme path.

## Preserve

- Keep saved preferences, normalization/migrations, reset subsets, custom values and same-/sibling-window synchronization; failed saves retain editable intent and target-local recovery.
- Keep System/Light/Dark, palette, custom accent, Accent readability and Pure/Tinted canvas as distinct choices. Keep Pure fallback for records without canvasBackground and custom-surface handling.
- Use shared semantic roles and real shared controls in previews; distinguish representative preview from native glass, installed-font, terminal-grid or GPU acceptance.
- Retain platform capability gates, dark-mode values and light opaque policy for native glass; blur-radius applicability is platform-specific.
- Workspace artwork is opt-in and separate from native translucency/Pure/Tinted preferences. Retain custom designs when disabled, merge independent sibling edits, hold conflicting retries, and keep the last usable design when storage is unreadable. Images/scenes remain above the base artwork; accessibility can hide artwork without clearing the saved choice.
- Keep global/project image precedence, original asset access, choose/change/remove/cancel, validation, pending ownership and partial-write recovery.
- Retain worker generations, error/retry, object-URL cleanup and canvas idle/visibility/reduced-motion/GPU lifecycle. Ambient crew appearance does not change executable Crew settings.
- Live scenes follow the appear/hold/rest rhythm in `live-background/calmSignal.ts`: a shown scene stays 10–15 s through output pauses and after the reply ends, rests 8–16 s, returns with later output of the same turn, and mouths move only while output arrives. The canvas keeps painting while the driver is awake and still settles once the scene is hidden.
- Keep density and scale behavior, including applying scale on release; source inclusion must be verified before diagnosing an owner capture.
- Keep every preference reachable while changing disclosure/layout. The advanced-visibility disagreement is recorded in the surface reference; this skill does not select a new policy.

## Workflow

1. Trace preference → normalized record → DOM/theme/runtime consumer, then check reset and sibling updates. For image changes follow native storage and project overrides too.
2. Use [theme colors](../../../docs/reference/theme-colors.md), [DESIGN](../../../docs/reference/DESIGN.md) and the Settings row contract in [UI design system](../../../docs/reference/ui-design-system.md) instead of copying local recipes.
3. Run focused model/controller or background lifecycle tests from the map; inspect affected themes, density, custom accent and keyboard states. Use isolated native/GPU checks only when those paths change.

## Focused checks

Run affected colocated tests in `src/features/settings/model/` and `src/features/settings/ui/`; cover appearancePersistence, nativeGlass, uiScale, image workers and picker/canvas lifecycle. Browser entries include `tests/browser/settings/settings.e2e.ts`, settings-layout and live-backgrounds scenarios.

## References

- Read [surfaces](references/surfaces.md) for ownership, storage/native identifiers, checks and the unresolved documentation issue.
- Read [decision provenance](references/decisions.md) only when changing canvas defaults or inherited layout decisions.

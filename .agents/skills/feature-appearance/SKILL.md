---
name: feature-appearance
description: "Change bycoda Appearance preferences, previews, theme/background selection or native glass controls. Preserve preference/reset semantics; use theme-foundation for shared color roles."
---

# Appearance development

All code paths below are repository-relative; linked skill resources are relative to this directory.

## When to use

Use for Appearance controls, durable preference outcomes, live previews, global/project backgrounds and motion/ambient choices. Shared CSS role changes also need [theme foundation](../feature-theme-foundation/SKILL.md); voice and executable Crews are separate features.

## Start here

- `src/features/settings/ui/AppearanceSettings.tsx`, `AppearancePreviews.tsx` and `useAppearanceSettings.tsx` own controls and previews.
- `src/features/settings/model/appearance.ts`, `appearancePreferences.ts` and `appearancePersistence.ts` own application, normalization and durable receipts.
- Read [surfaces](references/surfaces.md) only for the affected background/native/platform path.

## Preserve

- Preserve saved preferences, normalization/migrations, reset subsets, custom values and same-/sibling-window synchronization; failed saves retain editable intent and target-local recovery.
- Keep System/Light/Dark, palette, custom accent, Accent readability and Pure/Tinted canvas as distinct choices. Preserve Pure fallback for records without canvasBackground and custom-surface handling.
- Use shared semantic roles and real shared controls in previews; distinguish representative preview from native glass, installed-font, terminal-grid or GPU acceptance.
- Retain platform capability gates, dark-mode values and light opaque policy for native glass; blur-radius applicability is platform-specific.
- Preserve global/project image precedence, original asset access, choose/change/remove/cancel, validation, pending ownership and partial-write recovery.
- Retain worker generations, error/retry, object-URL cleanup and canvas idle/visibility/reduced-motion/GPU lifecycle. Ambient crew appearance does not change executable Crew settings.
- Preserve density and scale behavior, including applying scale on release; source inclusion must be verified before diagnosing an owner capture.
- Keep every preference reachable while changing disclosure/layout. The historical advanced-visibility disagreement is recorded in the reference; this skill does not select a new policy.

## Workflow and checks

1. Trace preference → normalized record → DOM/theme/runtime consumer, then check reset and sibling updates. For image changes follow native storage and project overrides too.
2. Use [theme colors](../../../docs/reference/theme-colors.md), [DESIGN](../../../docs/reference/DESIGN.md) and the Settings row contract in [UI design system](../../../docs/reference/ui-design-system.md) instead of copying local recipes.
3. Run focused model/controller or background lifecycle tests from the map; inspect affected themes, density, custom accent and keyboard states under current tier rules. Use isolated native/GPU checks only when those paths change.

## Read when needed

- Read [surfaces](references/surfaces.md) for ownership, storage/native identifiers, checks and the unresolved documentation issue.
- Read [decision provenance](references/decisions.md) only when changing canvas defaults or inherited layout decisions.

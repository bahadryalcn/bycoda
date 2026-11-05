---
name: feature-settings
description: "Change bycoda Settings navigation, search/reveal, shared settings rows, Policies or Connections. Route page-specific behavior to its feature skill."
---

# Settings development

All code paths below are repository-relative; linked skill resources are relative to this directory.

## When to use

Use for Settings shell, section/search metadata, shared Settings composition, Policies and Connections. For a single named page, read its specialist directly; use this entry additionally only if shell or shared contracts change.

## Start here

- `src/features/settings/ui/SettingsView.tsx`, `src/app/shell/SettingsRail.tsx` and `src/features/settings/model/settings.ts` own navigation and reveal.
- `src/features/settings/ui/settingsControls.tsx` and `BycodaSettings.css` own Settings presentation; verify the current collection adapter before editing.
- `src/shared/lib/storedSetting.ts` owns the preference primitive. See [routing and surfaces](references/surfaces.md) for Policies, Connections and page owners.

## Preserve

- Preserve section IDs, saved selection, search metadata, deep-link/reveal expansion and focus when changing navigation.
- Pages compose the shared Group/Row/AdvancedSettings owners; they do not introduce page-local row skins or a second overlay system.
- Preserve values, defaults, storage keys, custom values, validation and same-/sibling-window subscriptions; distinguish applied state from durable save.
- Retain drafts and in-flight ownership across tab changes, hidden panels and returning to Settings. Failed reads must not look like authoritative empty values.
- Policies changes preserve complete legal text, license, document language and offline fallback. Navigation changes must match the tab keyboard model.
- Connections changes preserve machine/Host identity, pairing secret lifecycle, credential gates and recovery. Visibility or pairing UI is not new remote execution authority.
- A skill, source map or old screenshot is not a runtime capability grant or proof of installed source inclusion.

## Workflow and checks

1. Trace the changed control from section/search metadata through persistence and its actual consumer; follow Host/native/mobile only when the operation crosses those boundaries.
2. For shared rows, read the Settings row contract in [UI design system](../../../docs/reference/ui-design-system.md); consult [Arc adapters](../../../docs/reference/arc-ui.md) for control/overlay behavior.
3. Choose focused settings model/control/view tests from the surface map; use the repository's current TypeScript check command when TS changes. Exercise affected pages, search/reveal, keyboard and storage failure under the current tier rules.

## Read when needed

- [Decision provenance](references/decisions.md): owner decisions for Settings groups and the three-state permission rule.

- For specialist page routing, Policies/Connections source paths and test entry points, read [surfaces](references/surfaces.md).
- For product-wide presentation, use [DESIGN](../../../docs/reference/DESIGN.md) and the [component catalog](../../../docs/reference/ui-component-catalog.md).

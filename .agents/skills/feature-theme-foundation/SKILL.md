---
name: feature-theme-foundation
description: "Change shared semantic theme roles, pane hierarchy, accent/focus/selection and forced-color behavior while preserving Appearance values and specialized content rendering."
---

# Theme foundation changes

## When and scope

Use for palette/theme role implementation under src/styles and its shared consumers. Appearance owns saved settings and applying them; shared UI owns reusable interaction presentation. Feature CSS composes layout rather than inventing theme colors.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding
directory. Follow current imports and callers; this map is not a completeness claim.

- `src/shared/theme/palette.ts`, `src/styles/palette.css`: palette seeds and generated variables.
- `src/styles/index.css`, `bycoda.css`: semantic surface/text/status/focus/geometry/motion roles.
- `src/styles/arc.css`: scoped semantic-to-Arc mapping.
- `src/shared/ui/ControlSpecimen.tsx` and representative shell/editor/terminal consumers: actual use of the roles.

## Preserve

- Preserve saved theme/custom colors, accent pairs, tint/contrast/fonts/scale/density and native translucency capability gates.
- Canvas, navigation panels, reading/forms and floating surfaces have distinct roles. Pane boundaries, control boundaries and focus are separate signals.
- Workspace canvases/panels use the centralized `--ui-workspace-*` roles; the owning main pane paints glass opacity once. Preserve opaque theme tones through the existing canvas/reading variants, plus reduced-transparency and forced-color fallbacks with matching selector specificity. Embedded content and floating controls keep separate owners.
- Sidebar chrome/cards/selection use `--ui-navigation-*` under the native-window gate independently of main-pane glass. Preserve readable status chips and opacity at actual overlapping/sticky text boundaries; verify scrolled content and colored backdrops before clearing a fill.
- Opt-in workspace artwork uses one `has-workspace-background` root image and an adaptive theme veil, with identical preview composition. Decorative gradient serialization/presets live in `src/shared/theme/workspaceBackground.ts`; explicit reduced-transparency/forced-color overrides hide artwork without requiring support for a positive media query. Never substitute artwork colors for control/status roles.
- User accent, running/on and status/diff meaning remain distinct. Derive new roles centrally; consumers do not copy mixing/opacity recipes.
- Keep editor overlay glyphs transparent, specialized CodeMirror/PDF/terminal selection adapters, native content colors and forced-color fallbacks.
- Shared semantic-role changes require representative consumers; color values or a successful typecheck alone cannot prove visual readability.

## Workflow

1. Identify the owning palette/semantic/Arc layer and all affected role consumers; read the existing ownership contract.
2. Change the role once, retaining light/dark/custom settings and compatibility aliases where required.
3. Inspect actual consumers for pane identity, focus/selection, disabled states and reduced-transparency/forced-color behavior.

## Focused checks

For palette changes, regenerate with `node scripts/checks/check-theme-colors.mjs --write`, then run `pnpm check:colors`; for semantic CSS changes use the applicable color/static checks and changed consumer tests.
Inspect shell, forms, lists, modal layers, editor/PDF selection and terminal in both themes, extreme accents/contrast/density, reduced motion/transparency and forced colors. Distinguish browser/fixture from native rendering.

## Read when needed

- [UI ownership and semantic roles](../../../docs/reference/ui-design-system.md#ownership-and-dependency-direction) for layer boundaries.
- [Theme colors](../../../docs/reference/theme-colors.md) for palette generation and content exceptions; project AGENTS rules govern consumer color use.
- [Appearance](../feature-appearance/SKILL.md) for settings; [Shared UI](../feature-shared-ui/SKILL.md) for adapter states.

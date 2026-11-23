---
name: feature-shared-ui
description: "Use when changing any UI in src/app, src/features or src/shared/ui. Not for semantic theme roles; see feature-theme-foundation."
---

# Shared UI

Any JSX under `src/app` or `src/features`, and any change in `src/shared/ui/`. Features own domain data, drafts, permissions and screen layout; shared components own presentation, spacing, focus, states and accessibility.

## Source starts

- `src/shared/ui/`: reusable components and their public JSDoc contracts.
- `scripts/checks/`: catalog generation and UI drift enforcement.

## Workflow

1. Find the need in [the component catalog](../../../docs/reference/ui-components.md). It is generated from the JSDoc in `src/shared/ui/*.tsx`: each row says what to use and what not to.
2. Open the chosen component and read its JSDoc header and props before using it. Use it the way its `@use` line says; when its `@avoid` line matches your case, take the component it names.
3. Missing capability: extend the owning shared component (or add one in `src/shared/ui/`) with the full JSDoc block (`@group`, `@use`, `@avoid`, optional `@replaces`, `@status`, `@instead`, `@arc`), then run `pnpm check:ui-catalog --write`. Never hand-roll it inside a feature.
4. Check the catalog when its inputs change. Use the verification schedule in [Testing](../../../docs/reference/testing.md#order-of-verification).

## Preserve

- Dialogs: `Modal`/`Sheet` pad their body. Do not add body padding; pass `padding="none"` only for full-bleed content (lists with row padding, editors, previews, master–detail panes).
- Forms: `Select` shows its label like `TextField`; `hideLabel` only in toolbars and compact filters, where an associated group label or accessible name identifies the control.
- `SegmentedControl` owns short exclusive choices; `EffortScale` owns effort and subagent ceiling bars.
- Raw tags listed in the catalog's Replaces column (`details`, `dl`, `label`, `table`, `time`, `role=tab`, …) are banned outside `src/shared/ui`; use the named component.
- Deprecated components (catalog's last table) may not be imported in new code.
- Actions use `Button` (or ActionHost inline actions); no screen-specific button styling.
- Semantic tokens only; no literal colors, font sizes, radii or z-index; preserve density settings.
- One overlay stack: Popover, Modal, Sheet, Tooltip and the menus; no own focus trap or Escape handler.
- One fact, one owner: render each message once (field, row, form footer, pane banner or one toast) and never repeat it in a tooltip, `disabledReason` or a second channel. `disabledReason` only for a non-obvious cause with no visible explanation.
- An icon-only action has an accessible name (`label`); that name is not a tooltip. A tooltip appears only when it adds a shortcut, reason or detail and never repeats a visible label (`tooltip-repeats-label` catches the literal case). Use OverflowTooltip only to recover clipped or responsively hidden text. Familiar icons need no tooltip.
- No inline help paragraphs: optional help is an info (ⓘ) control on demand; required validation, consequences and recovery stay visible. `InfoTooltip` for a short note, `InfoPopover` for structured details. Delete redundant copy first.
- Variants, never feature styling: `Button variant="chip"` (icon plus readable value), `SectionLabel variant="rail"`, `RadioGroup` tiles `tileLayout`, `PaneHeader` `primaryAction`/`overflow`. Spacing and overlay roles are tokens: `--ui-space-*`, `--ui-list-gutter`, `--ui-floating-edge`, `--ui-floating-shadow`, `--ui-radius-floating`.
- Overlays are opaque and theme-bound: one floating ground, edge, shadow and radius; no private frost or palette. Density is the saved preference; a narrow pane changes arrangement, never density. Check each pane at 320 px.
- Import only `src/shared/ui/*` from product code, never `src/shared/ui/arc/*`.
- A settings `Group` is already a framed card: no `Group` or card `Surface` inside it and no `Group` inside a card (`nested-surface`). Compose screens from the archetypes in DESIGN.md, not new containers.
- Feature code places things and never chooses how they look: no type, surface, state, control size, truncation, motion or scrollbar styling in `src/features` or `src/app`, and an inline style carries custom properties only. Layout stays free. Read [appearance ownership](references/appearance-ownership.md) before writing feature CSS or classes.
- Bespoke surfaces (composer editor, transcript, terminal, code editor, scene previews) may keep a custom element no shared component can carry; mark that line with `// ui-drift-ignore: <rule> -- <why>` above it.

## Focused checks

- `pnpm check:ui-catalog`: every shared component has metadata and the generated catalog is current.
- `pnpm check:ui-drift`: raw tags, deprecated imports, double Modal padding, token drift and appearance ownership (ratchet).
- Visual acceptance: `node scripts/checks/ui-acceptance-matrix.mjs --list` and `--out temp/verification/<id>/matrix` capture every archetype in light and dark at 1280 and 800 px (see `docs/reference/testing.md`).
- Focused tests cover the changed component and representative consumers; screenshot affected surfaces in light and dark when the UI visibly changes.

## References

- [Appearance ownership](references/appearance-ownership.md): what feature code may not style, the rule for each, container states (empty, loading, failure) and how to run a UI round.
- [Decision provenance](references/decisions.md): the one file for owner UI decisions, including shell and workbench.
- [Product design language](../../../docs/reference/DESIGN.md) for new patterns and T2 work.
- [UI contracts](../../../docs/reference/ui-design-system.md) for tokens, feedback and field contracts.
- [Arc integration](../../../docs/reference/arc-ui.md) for installing or adapting Arc registry items.
- [Theme](../feature-theme-foundation/SKILL.md) for new semantic roles.

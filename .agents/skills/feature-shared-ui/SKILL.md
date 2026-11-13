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
4. Run `pnpm check:ui-catalog` and `pnpm check:changed`.

## Preserve

- Dialogs: `Modal`/`Sheet` pad their body. Do not add body padding; pass `padding="none"` only for full-bleed content (lists with row padding, editors, previews, master–detail panes).
- Forms: `Select` shows its label like `TextField`; `hideLabel` only in toolbars and compact filters.
- `SegmentedControl` owns short exclusive choices; `EffortScale` owns ordered model effort and subagent ceiling bars. Supply translated full labels; the scale keeps them outside its bars and in tooltips. Provider save destinations are a feature-owned multi-select, not an exclusive segmented choice.
- Raw tags listed in the catalog's Replaces column (`details`, `dl`, `label`, `table`, `time`, `role=tab`, …) are banned outside `src/shared/ui`; use the named component.
- Deprecated components (catalog's last table) may not be imported in new code.
- Actions use `Button` (or ActionHost inline actions); no screen-specific button styling.
- Semantic tokens only; no literal colors, font sizes, radii or z-index; preserve density settings.
- One overlay stack: Popover, Modal, Sheet, Tooltip and the menus; no own focus trap or Escape handler.
- Tooltips never repeat a visible label; omit redundant content at its source. They add a shortcut, detail or reason. Shared Tooltip renders explicit content unchanged; use OverflowTooltip only to recover clipped or responsively hidden text.
- Feature code places things and never chooses how they look: no type, surface, state, control size, truncation, motion or scrollbar styling in `src/features` or `src/app`, and an inline style carries custom properties only. Layout stays free. Read [appearance ownership](references/appearance-ownership.md) before writing feature CSS or classes.
- Bespoke product surfaces (chat composer editor, transcript, terminal, code editor, appearance scene previews) may keep a custom element when no shared component can carry the behavior. Mark that one line with `// ui-drift-ignore: <rule> -- <why>` on the line above (in JSX `{/* ... */}`); everything around it still uses shared components.

## Focused checks

- `pnpm check:ui-catalog`: every shared component has metadata and the generated catalog is current.
- `pnpm check:ui-drift`: raw tags, deprecated imports, double Modal padding, token drift and appearance ownership (ratchet).
- Run focused tests for the changed component and representative consumers; take light and dark screenshots of affected surfaces when the UI visibly changes.

## References

- [Appearance ownership](references/appearance-ownership.md): what feature code may not style, the rule for each, and the review item for empty, loading and failure states.
- [Decision provenance](references/decisions.md): owner decisions behind the shared UI rules.
- [Product design language](../../../docs/reference/DESIGN.md) for new patterns and T2 work.
- [UI contracts](../../../docs/reference/ui-design-system.md) for tokens, feedback and field contracts.
- [Arc integration](../../../docs/reference/arc-ui.md) for installing or adapting Arc registry items.
- [Theme](../feature-theme-foundation/SKILL.md) for new semantic roles.

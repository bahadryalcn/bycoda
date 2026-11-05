---
name: feature-shared-ui
description: "Choose, extend and verify bycoda shared controls and Arc adapters, preserving public APIs, native semantics, interaction state and representative consumers."
---

# Shared UI development

## When and scope

Use for reusable actions, fields, choices, rows, feedback, overlays and layout primitives. Features own domain data/drafts/permissions/layout; theme owns semantic roles. This skill routes to existing design references rather than duplicating their catalog.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding
directory. Follow current imports and callers; this map is not a completeness claim.

- `src/shared/ui/`: public controls and reusable interactions; `ControlSpecimen.tsx` is the real reference consumer.
- `src/shared/ui/SectionLabel.tsx`: section and compact menu captions.
- `src/shared/ui/ContinuousList.tsx`: retained collections and continuation footer.
- `src/shared/ui/LoadingText.tsx`: loading status lines.
- `src/shared/ui/ConfirmDialog.tsx`, `src/shared/hooks/useCopyFeedback.ts`: confirmation and copy feedback.
- `src/shared/ui/arc/`: registry source and reviewed local adaptations; application consumers use public adapters.
- `src/styles/arc.css`, `index.css`, `bycoda.css`: semantic role mapping and shared presentation.
- `tests/browser/arc-controls*` and affected feature consumers: verification entry points.

## Preserve

- Reuse or extend a public adapter before adding a duplicate. Shared presentation owns size/tone/focus/disabled/loading; caller className owns placement.
- Keep public props, ref/native form semantics, keyboard/IME/cursor/selection, free-entry distinctions and actual action permission callbacks.
- Keep menus/overlays on the existing Popover/Modal/overlay routing; do not create a second stack, Escape handler or focus trap.
- Do not repeat readable text in a tooltip. Use Button `tooltipWhen="overflow"`, Tooltip/useTooltip `when="overflow"` or `OverflowTooltip` for clipped/hidden labels; keep icon explanations, additional context, missing shortcuts and disabled reasons. OverflowTooltip composes onto one child without changing its DOM parent or ref.
- Rows and inline actions retain distinct selection, pending/error, drag and action ownership. Hidden/hover presentation must remain operable by keyboard and touch.
- Optional input observation cannot force blur, normalize drafts, commit IME or grant unrelated async work authority. Check the actual runtime contract when changing it.
- Use semantic theme roles and density/motion settings; native trees, tabs, links and window controls retain their specialized semantics.

## Workflow

1. Use the component catalog to choose the interaction; inspect the public adapter and callers before changing its API.
2. Implement the reusable gap once at the owning shared layer; migrate affected consumers without replacing domain state owners.
3. Update the real specimen and public API reference when behavior changes; exercise representative consumers and exceptional native semantics.

## Focused checks

Run focused tests for the changed primitive plus representative consumers. Use `pnpm check:web` for applicable TypeScript/web checks; use the project normal compiler commands and label any explicit fast mode.
Inspect keyboard, narrow/short panes, light/dark/custom accent, density, reduced motion, disabled/pending/error and nested overlay states. A specimen inventory alone is not consumer acceptance.

## Read when needed

- [Decision provenance](references/decisions.md): owner decisions behind badges, collection scrolling and the UI standards round.

- [Component selection](../../../docs/reference/ui-component-catalog.md) before choosing/adding a control.
- [UI contracts and ownership](../../../docs/reference/ui-design-system.md) for public APIs, feedback, fields and semantic roles.
- [Arc integration](../../../docs/reference/arc-ui.md) for registry/adapters and local adaptations; [Theme](../feature-theme-foundation/SKILL.md) for new semantic roles.

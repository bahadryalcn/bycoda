# Appearance ownership

Feature code places things; the shared component decides how they look. In `src/features` and
`src/app` (CSS, CSS modules, `className` and `style`) the rules below are enforced by
`check:ui-drift`, one rule each. They ban properties, not component names: the component to use
comes from the catalog.

| Not written in feature code                                                       | Rule                                    |
| --------------------------------------------------------------------------------- | --------------------------------------- |
| Font size, weight, line height, letter spacing, text color: `Text`                | `feature-typography`                    |
| Border, outline, radius, background, shadow                                       | `surface-style`                         |
| `:hover`, `:active`, `:focus*`, `[aria-selected]` and their class variants        | `interaction-state`                     |
| Height, minimum height or padding on a control                                    | `fixed-control-size`                    |
| Truncation and line clamp: `Text truncate`, `ClampText`, `MiddleTruncate`         | `text-truncation`                       |
| Transition and animation: `Motion`                                                | `feature-motion`                        |
| Scrollbar styling: `ScrollArea`                                                   | `scrollbar-style`                       |
| A CSS property in `style={{ … }}`; an inline style carries custom properties only | `inline-style-property`                 |
| A literal gap, padding or margin off the spacing scale                            | `spacing-step`                          |
| Icon size and stroke                                                              | `icon-size-class`, `icon-numeric-size`… |

- Layout is free: `display`, `grid`, `flex`, `gap`, `margin`, `width`, `overflow` and alignment
  belong to the feature.
- Spacing: `var(--space-*)` is always allowed and is the preferred form. Only a literal off the
  scale is reported: a bare px/rem value other than 0, 4, 6, 8, 10, 12, 14, 16, 20 or 24 px, or a
  Tailwind step other than 0, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6.
- Classes are read from `className`-like attributes, properties and variables and from the
  arguments of `cn(…)`/`clsx(…)`, whatever the result is named.
- A clickable row or card is `Button variant="item"`, or `ActionHost` when it carries inline
  actions; a hover fill written in feature CSS is not a way to make one.
- No matching role or variant: add it to the shared component (or write a new one), regenerate
  the catalog, then use it. Never solve it in the feature and never invent a component name.
- Migrating existing code: behavior, ids, `aria-*`, `data-*` and test ids stay. Tests are
  updated, not deleted. Do not start a migration that needs a component the catalog does not
  have yet; see "Migration" and "Open items" below.
- The rules skip the bespoke surfaces listed by file path in
  `scripts/checks/ui-drift-appearance.mjs` (transcript and markdown output, chat composer editor,
  terminal, code and diff editors, document and media viewers, appearance previews, drawn scenes); every other
  drift rule still applies there. A toggle, menu or toolbar next to such a surface is an ordinary
  control and is not listed. Adding a file to the list is an owner decision.
- Breakpoints (`@media`, `@container`) have no shared step list yet and are not checked.

Review, because no rule can see it: empty, loading and failure states are `EmptyState`,
`LoadingText`, `Skeleton` and `FailureState`. The rules catch the known shapes (a loader icon as
a spinner, `role="alert"`, `aria-live`, unguarded `animate-spin`); a hand-written "nothing here"
block or a text-only "Loading…" passes them and must be caught in review.

## Migration

Decisions that hold for every migration of existing feature code to `Text`, `ScrollArea` and
`Motion`:

- Order: typography first, then scrollbars and motion.
- Nothing grows: pick the role equal to the old value, or the nearest smaller one. Never round up.
- Line height 1.6 becomes `leading="normal"` (1.5), not `relaxed` (1.625).
- Truncation: one line is `Text truncate`, several lines are `ClampText`, a path or id is
  `MiddleTruncate`. A clamp that had no "Show more" migrates with `expandable={false}`.
- `ScrollArea` is required only where the scrollbar itself is touched (hidden bar, stable gutter).
  A plain `overflow` is layout: it stays in the feature and is not migrated.
- `Motion` adds an element. Inside a flex or grid container the new box takes the place of the
  child, so check that the layout is unchanged before migrating; when it cannot be kept, leave
  the finding and add it to the open items.

## Open items

Findings the shared components do not cover. They stay in the baseline on purpose; each needs an
owner decision (a new variant, a new component, or a bespoke-surface entry) before it can be
migrated. Counts are class uses plus CSS declarations outside the bespoke surfaces when the
components were written; update the row when a pattern is resolved.

| Rule                 | Pattern                                                                                                                      | Count | Why it is not covered                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature-typography` | `tracking-*`, `letter-spacing`                                                                                               | 11    | Five different values; no shared letter-spacing role exists.                                                                                                                                              |
| `feature-typography` | Diff inks `text-diff-add-fg`, `text-diff-del-fg`                                                                             | 26    | Belong to the diff surface; `Text` has no diff tone.                                                                                                                                                      |
| `feature-typography` | Feature-owned inks: `--runtime-log-*`, `--host-tool-muted`, `--chip-ink`, `text-skill`, `text-orchestration`, `text-mention` | 40    | Tokens of one feature, not shared ink roles.                                                                                                                                                              |
| `feature-typography` | Fixed line heights: `leading-3`, `leading-4.5`, `leading-6`, `leading-label`, `leading-[1.45]`, CSS 1.45 / 1.55 / 1.65 / 1.7 | 24    | One-off values between the five leading roles; each needs a role choice in review.                                                                                                                        |
| `feature-typography` | Literal or relative sizes: `0.75rem`, `0.9em`, `text-[0.92em]`, `var(--text-sm)`                                             | 7     | Not a type role; relative sizes scale with a parent on purpose.                                                                                                                                           |
| `text-truncation`    | A silent clamp to two or more lines (`line-clamp-2`…, `-webkit-line-clamp`)                                                  | 38    | Covered by `ClampText expandable={false}`. Still open per use: check that the full text is reachable elsewhere (detail view, tooltip, the row's page) before migrating; where it is not, keep the action. |
| `text-truncation`    | `text-overflow: clip`                                                                                                        | 5     | A hard cut without an ellipsis; `Text truncate` always shows one.                                                                                                                                         |
| `feature-motion`     | Loops: ping, pulse, charge, dictation spin and dot, action working                                                           | 6     | Each has its own keyframes and no shared shape. Waiting belongs to `Spinner` and `WorkingIndicator`.                                                                                                      |
| `feature-motion`     | Directional enter (voice panels slide in from a side) and a scaled enter                                                     | 5     | Direction comes from a custom property; `Motion enter` only rises.                                                                                                                                        |
| `feature-motion`     | Exit and one-shot effects: queue departure, settings reveal flash, session row dwell                                         | 3     | Timed to feature state; no shared exit.                                                                                                                                                                   |
| `feature-motion`     | Mixed properties: width with opacity, colour with transform, `max-block-size`, `outline-color`, background with shadow       | 5     | `Motion transition` eases one property group.                                                                                                                                                             |
| `feature-motion`     | Delays, `duration-500`, `ease-linear`                                                                                        | 6     | `Motion` has two durations, one easing and no delay.                                                                                                                                                      |
| `scrollbar-style`    | `scrollbar-width: thin`                                                                                                      | 1     | The shared bar is already thin; one use does not justify a variant.                                                                                                                                       |
| `scrollbar-style`    | `scrollbar-preview*` classes of the Appearance scrollbar setting                                                             | 3     | A preview of the scrollbar itself.                                                                                                                                                                        |

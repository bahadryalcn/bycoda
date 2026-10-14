# Shared theme colors

`src/shared/theme/palette.ts` is the source of fixed color values. It contains UI
primitives, effects, ANSI, syntax and artwork colors. Do not add literal hex,
RGB, HSL or OKLCH colors to components or feature styles.

`src/styles/palette.css` is generated from this source. After changing the palette,
run `node scripts/checks/check-theme-colors.mjs --write`. Run `pnpm check:colors`
to verify generated CSS and detect color literals or raw Tailwind color families
outside the palette. Test fixtures are excluded from this rule.

## Product controls

Use semantic roles rather than palette primitives:

| Purpose | Role |
| --- | --- |
| Background and text | `--color-background-base`, `--color-content` |
| Card and raised surface | `--ui-surface`, `--ui-surface-raised` |
| Muted, hover and pressed surface | `--ui-surface-muted`, `--ui-surface-hover`, `--ui-surface-pressed` |
| Primary button feedback | `--ui-primary-hover`, `--ui-primary-pressed` |
| Secondary and disabled text | `--ui-text-secondary`, `--ui-text-disabled` |
| Structural border | `--color-stroke` |
| Error, warning, success and information | `--color-danger`, `--color-warning`, `--color-success`, `--color-info` |
| Feature and orchestration cues | `--color-feature`, `--color-orchestration` |
| Search matches | `--color-search` |
| Diff additions and deletions | `--color-diff-add`, `--color-diff-del` |
| Invariant overlay colors | `--color-scrim`, `--color-on-solid` |

Tailwind classes such as `text-danger`, `bg-warning/10` and `border-success/20`
use these roles and adapt to the light or dark theme. Avoid `text-red-400` and
similar palette-specific classes. Surface roles mix in OKLab to avoid hue rotation
between the workbench's light text and dark background.

## Rendered content

Canvas and ANSI consumers require actual color values, so import `themePalette`
instead of passing CSS variables to them. Character art, syntax highlighting and
terminal output retain their distinct colors. Native assets and externally
supplied or user-selected colors are content, not product control colors.
Calculated colors such as HSV picker gradients may remain calculations.

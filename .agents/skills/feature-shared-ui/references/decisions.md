# Shared UI decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## UI standards round

Owner decision, 2026-11-01, UI standards round, source: owner chat:

> okay, please start on the fixes, all of them (translated)

Recorded decision: missing shared primitives are built, drift is caught by the UI drift check, and screens migrate onto the shared parts. See the component catalog for current coverage.

## Badges and status tones

Owner decisions, 2026-10-27 (badge sizes), 2026-10-28 and 2026-11-04 (no stripe on running cards; Question badge tone), confirmed 2026-11-05. Recorded decisions: counter badges are small, borderless labels from the user's accent, the same height as caption text, and keep `99+` and exact counts. A pending question or approval uses the warning tone. Running work uses an accent dot or activity icon, not an edge stripe.

## Collections scroll, they do not page

Owner decisions, 2026-10-27 (MCP, Jira), confirmed 2026-11-05 as the default for all collections. Recorded decision: lists are continuous bounded windows that extend on scroll. An explicit "load more" is used only where a backend requires a controlled step. Numbered pagination controls are removed.

## Components document themselves

Owner decision, 2026-11-08, source: owner chat:

> let us write what each component really does and introduce the appropriate skills ... we need to solve all of it permanently (translated)

Recorded decision: each shared component's JSDoc (`@group`, `@use`, `@avoid`, `@replaces`, `@status`, `@instead`) is the single source of truth. The component catalog is generated from it, `check:ui-drift` bans the raw tags it replaces and deprecated imports, and Modal/Sheet own their body padding.

## Tooltip content belongs to its caller

Owner decision, 2026-11-11, source: owner chat:

> Butonda isim varsa bunu kod ile değil direk kaldırmamız gerekiyor gereksiz kodlara workaroundlar istemiyorum.

Recorded decision: remove redundant tooltip content at its source. Shared Tooltip renders explicitly supplied content unchanged; it does not compare the title with visible control text and remove matching words. Visible text buttons do not generate name tooltips automatically. Keep icon explanations, shortcuts, disabled reasons, additional context and explicit recovery of clipped or responsively hidden text.

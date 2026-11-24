# Shared UI decision provenance

UI decisions for the whole product live in this one file: shared components, tokens, shell and
navigation. Feature-specific choices stay in that feature's `references/decisions.md`.

Entry format: owner quote with date and source, the recorded decision, and a final line
`Rule text: <file>` naming the DESIGN.md, ui-design-system.md or check rule edited in the same
change. A decision that reverses a rule is not recorded until that rule text is updated.

## Menu labels within the window

Owner decision, 2026-11-13, source: owner chat:

> İçerikler panel sınırında kırpılmasın. Popup’lar pencereye sığsın.

Recorded decision: menu action labels retain their natural popup width up to the
shared viewport cap, then wrap inside their row instead of painting outside it.
Unbroken names and paths can break at the available width. Shared menu slots own
this behavior; trailing shortcuts and checks keep their alignment.

## One shared date and time picker family

Owner decision, 2026-11-12, source: owner chat:

> Bir tane timepicker datepicker datetimepicker daterangepicker datetimerangepicker yapmanı istiyorum ... yeni componentleri kullanmayı zorunlu tutalım

Recorded decision: `TimePicker`, `DatePicker`, `DateTimePicker`, `DateRangePicker` and
`DateTimeRangePicker` own date/time entry across features. They share field framing,
popover placement, keyboard calendar navigation, locale-aware time columns and typed
entry. Native date/time types on raw inputs or shared field components are prohibited
in feature/app code by `native-date-input`. `DateTimeField` remains a compatibility
export for existing mode-based consumers.

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

## Short help uses one tooltip

Owner decision, 2026-11-23, owner chat.

> help yazısına gerek yok üzerine gelince gözüksün. Gereksizse tamamen bile kaldırabilrisin

Short optional explanations use a passive tooltip on hover and keyboard focus. Remove redundant hints. Structured details can use a dedicated opener with an accessible name. Keep required context visible next to the control.

## Cards, control groups, titles and file pickers come from shared components

Owner decision, 2026-11-11, source: owner chat:

> Elle yazılmış kart filan demişsin ya bunların hepsini düzeltelim form legend fieldset vs hiç birini elle istemiyorum ortak componentler variantlar la gösterimi değişebilir.

Recorded decision: features do not hand-write cards, `fieldset`/`legend` groups, titles or native file inputs. `Surface` (variant `card` for the grouped card), `FieldGroup`, `Heading` (roles `page`, `section`, `item`) and `FileField` own that presentation; a different look is a variant of the shared component, not a feature recipe.

## Full-black canvases keep visible layers and the lift is adjustable

Owner decision, 2026-11-11, source: owner chat:

> full siyah renklerde arka planlar yapabilmek istiyorum ... insanlarda kendileri ayarlıyabilmelilier ... zemin renginden yada otomatik olarak ayarlansın kendi.

Recorded decision: derived layers mix from `--ui-layer-base`, which never drops below the default depth, so a pure black canvas keeps its card, field, hover and border steps. On the pure dark canvas floating surfaces sit one visible step above the ground and grouped cards carry a faint fill; this replaces the earlier "settings groups have no fill" rule for that canvas only. The Appearance preference Surface contrast (`surfaceContrast`, `--appearance-layer-strength`) scales the lift and is part of saved and AI-generated looks.

Rule text: DESIGN.md "Elevation & Depth" (faint grouped-card fill on Pure dark) and
ui-design-system.md "Settings row contract".

## Feature code does not choose appearance

Owner decision, 2026-11-11, source: owner chat:

> Feature kodu görünüm seçmez; görünüm ortak bileşenden gelir. ... Kural yasaklanan özellik üzerinedir, bileşen adı üzerine değil. ... Her madde check-ui-drift'te ayrı kural; mevcut sayı baseline olur, sadece düşer.

Recorded decision: in `src/features` and `src/app`, type, surfaces, interaction states, control sizes, truncation, motion, scrollbars and inline style properties come from shared components; layout stays in the feature; `var(--space-*)` is always allowed and only a literal off the spacing scale (Tailwind steps 0, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6) is reported. Bespoke surfaces are exempt by explicit file path, never by a word in the file name. Each ban is its own `check:ui-drift` rule with the existing count as its baseline. An inline style carries custom properties only. Known empty, loading and failure shapes are rules; the rest is a review item. Breakpoint steps are deferred until a shared list exists. Migration does not start for a need the catalog cannot meet; `Text`, `ScrollArea` and `Motion` were written first, with variants taken from the existing feature usage and defaults equal to the most common value.

## Toasts are one Arc-style stack

Owner decision, 2026-11-11, source: owner chat, pointing at Arc's toast and toast-stack components:

> toast yapımız çok basit eski tip gözüküyor bu tarz yapıya geçelim lütfen ortak bir yapı olsun heryer aynı şekilde kullanaiblsin.

Recorded decision: every toast is the one shared card (tone glyph, title, description, one pill action at the end of the row, dismiss) in one stack per corner: newest in front, three visible, fanned out on hover or keyboard focus. Feature cards in `ToastSlot` share the corner but stay outside the stack.

## Component families

Owner decision, 2026-11-12, source: owner chat:

> eğer farklı componentse gösterim filan farklıysa tamam ama aynı işi farklı şekilde gösteren bir componentse bunun düzeltilmesi gerekiyor ... tutarlı görünüm istiyorum

Recorded decision: components with the same job share one appearance and owner. Distinct jobs remain
separate and explain their choice in catalog JSDoc. Shared wrappers own Arc and native popup access;
feature code uses those wrappers. The UI drift and catalog ratchets enforce imports, floating-surface
ownership, family metadata, unused exports and known hand-written control recipes.

## One component system

Owner decisions, 2026-11-15, source: owner chat:

> heryer aynı component tasarımlarını kullanması gerekiyor. Eğer farklıysa o component özel bir componenttir fakat onunda benzer tasarım anlayışıyla yapılması gerekiyor biri native biri bycoda biri arc ui olmaması gerekiyor.

Recorded decision: one spec ("One component system spec" in the desktop design system)
governs shared components, Arc adapters, native windows and feature-special components.
Owner choices in the same round: no focus visuals on
pointer interaction (keyboard and forced-colors only); the transcript user prompt is a
right-aligned borderless bubble; settings apply instantly with per-row reset; soft
white-alpha state fills; faint field resting border; row,
field and empty-state descriptions behind the info affordance by default; native
`alert`/non-blocking `message()` dialogs become Toast/Alert. This replaces the earlier
"descriptions visible by default" settings rule and the transcript "no bubbles" rule.

Rule text: DESIGN.md "One component system" and "Screen archetypes"; ui-design-system.md
"One component system spec" and "Settings row contract".

## Navigation tool group ground

Owner decision, 2026-11-13, source: owner chat:

> buranın arka plan rengi farklı. Bunun arka planla aynı olması gerekiyordu. Hover ı var fakat selected ı gözükmüyor bununda gözükmesi gerekiyordu

Recorded decision: `ButtonGroup surface="navigation"` paints no fill in any theme, glass and
workspace artwork included; the joined tools share their bar's ground and keep the group outline.
The selected tool always shows the gliding plate across its whole segment.

Follow-up, 2026-11-15, source: owner chat:

Recorded decision: hairlines (pane and card borders, settings row dividers) stay faint
(about 8-10% ink); the default chat width stays 56rem.

## Shell and workbench: owner reference conversation

Merged from the workbench-design card. Historical owner choices are design context, not session
ownership, current operation approval or proof of implementation.

Source: owner reference conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`, 2026-10-27.

- "Compact tools, airy content (my recommendation)" (translated)
- "Fewer boxes and borders (my recommendation)" (translated)
- "Short summary, details expand (my recommendation)" (translated)
- "A single plain status indicator; figure optional (my recommendation)" (translated)
- Clarification: "The separations and so on need to be clearer." (translated)

The clarification retains clear pane, task and action boundaries while reducing
decorative containment. Summary/disclosure must preserve inspection and recovery;
these choices do not remove functions, change stored defaults or bypass gates.

## Shell and workbench: Product-wide redesign outcome

Owner direction, 2026-10-28, session `0567326f-aade-4baa-89f3-b44c6256ae9e`:

> I had said I want a brand new design approach everywhere. Something was needed in the reference app's class (translated)

The redesign covers complete screen and control groups, with the reference app as a quality reference. Acceptance is per whole surface, not per token or padding change.

## Shell and workbench: Project rail, sidebar and settings layout

Owner correction, 2026-10-28, session `0567326f-aade-4baa-89f3-b44c6256ae9e`:

> in the leftmost menus, projects, groups, last sessions and so on have gaps between them and take up a lot of space. (translated)

> let us also write the "development" text at the top in color at the bottom left, or show it with an icon (translated)

> the Settings screen does not seem to have to be full screen anymore (translated)

Recorded direction: the rail uses one neutral ground with no inner tray; section headings use a tight rhythm; development build identity moves to the lower-left footer as a compact status label or icon. Ordinary settings use a bounded shell; list/detail workspaces may use a wider, maximize-capable shell.

## Shell and workbench: Navigation shares the chat canvas

Owner decision, 2026-10-31, V3-033, source: `temp/local/2026-10-31-ui-refinements-3/TODO.md` (rail/sidebar/chat screenshots):

> here the leftmost area and this area have different colors from there; I want them to be like the chat panel on the right, with the same background color, already separated by borders; please let us fix this (translated)

Recorded direction: the project rail and sidebars use the chat canvas in light, dark and custom themes; pane borders provide separation.

## Shell and workbench: One title bar across the window

Owner decision, 2026-11-24 (macOS and Windows screenshots of the top-left window chrome; variant B of `temp/local/top-chrome-preview/`):

> these places are very inconsistent and overlap […] show it in a better form that fits both platforms, does not get mixed up and has no unnecessary things (translated)

> when it is shrunk only the logo can stay, no need to write bycoda (translated)

Recorded direction: every main window has one title bar across its full width with one slot order on every platform: window slot (macOS traffic-light inset), sidebar toggle, brand, Back, Forward, Search, session tabs, then the Windows and Linux window buttons. The brand shows its wordmark only while the project rail is expanded; off macOS it is the application menu button. The project rail, the compact rail and the sidebars hold no brand row, history buttons, sidebar toggle or Search. Surfaces below the bar reserve no traffic-light inset and draw no window buttons (`WindowTitleBarAbove`, `BelowWindowChrome`). Detached session and tool windows keep their own title bar.

## Shell and workbench: Focus frames and edge stripes

Owner correction, 2026-10-28, session `0567326f-aade-4baa-89f3-b44c6256ae9e`:

> borders and the like appear on focus; I do not want these, for example stripe lines on the left, right, bottom and top; these need tidying up too. (translated)

Recorded direction: no surrounding focus frame or decorative edge stripe on a large composer, panel, card or row. Required input, drag and resize boundaries are handled separately.

## Feedback: One top-center alert location

Owner decision, 2026-11-16:

> let us gather the alerts in one single place […] and show them at the top centre of the page; the same errors are shown in so many places … not only errors, infos and warnings arrive like this too (translated)

Recorded direction: every toast, warning and information notice, including feature cards in `ToastSlot`, uses the shared `top-center` stack (`DEFAULT_TOAST_PLACEMENT`). A machine connection failure is shown once there; panes, rows and fields do not repeat it or add their own small retry while it is shown (`connectionErrorGate`). Redundant information and success toasts are removed rather than moved.

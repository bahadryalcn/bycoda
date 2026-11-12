# Shared UI decision provenance

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

## Cards, control groups, titles and file pickers come from shared components

Owner decision, 2026-11-11, source: owner chat:

> Elle yazılmış kart filan demişsin ya bunların hepsini düzeltelim form legend fieldset vs hiç birini elle istemiyorum ortak componentler variantlar la gösterimi değişebilir.

Recorded decision: features do not hand-write cards, `fieldset`/`legend` groups, titles or native file inputs. `Surface` (variant `card` for the grouped card), `FieldGroup`, `Heading` (roles `page`, `section`, `item`) and `FileField` own that presentation; a different look is a variant of the shared component, not a feature recipe.

## Full-black canvases keep visible layers and the lift is adjustable

Owner decision, 2026-11-11, source: owner chat:

> full siyah renklerde arka planlar yapabilmek istiyorum ... insanlarda kendileri ayarlıyabilmelilier ... zemin renginden yada otomatik olarak ayarlansın kendi.

Recorded decision: derived layers mix from `--ui-layer-base`, which never drops below the default depth, so a pure black canvas keeps its card, field, hover and border steps. On the pure dark canvas floating surfaces sit one visible step above the ground and grouped cards carry a faint fill; this replaces the earlier "settings groups have no fill" rule for that canvas only. The Appearance preference Surface contrast (`surfaceContrast`, `--appearance-layer-strength`) scales the lift and is part of saved and AI-generated looks.

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

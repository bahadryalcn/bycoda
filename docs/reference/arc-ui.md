# Arc UI integration

Arc source is installed with the project-pinned shadcn CLI into `src/shared/ui/arc/`.
`components.json` registers `@uiarc` and maps components to `src/shared/ui`.

```powershell
pnpm exec shadcn add @uiarc/<component>
```

Review the registry item and its dependencies before installing. Do not pass
`--overwrite` to an adapted item without reviewing the local changes below.

## Reuse decision rules

The root `AGENTS.md` defines the mandatory UI reuse policy. This guide describes
how to apply it. Existing feature behavior remains authoritative during migration.

1. Find the owning screen and search shared adapters and similar consumers for the
   needed interaction. Read the component's current props, local adaptations and
   relevant tests; installation alone does not mean all screens use that component.
2. Compose existing adapters for a screen-specific layout. A feature component is
   appropriate when it owns real domain behavior or data; it must delegate standard
   control presentation rather than copy it.
3. If a reusable presentation or interaction is missing, extend the owning shared
   adapter with the smallest explicit prop or variant. Keep state ownership and
   persistence in their existing feature layer. Do not add boolean combinations or
   wrappers that duplicate an existing variant, size or state.
4. Add a new shared adapter only when existing components cannot meet a concrete
   requirement without distorting their responsibilities. Describe that requirement
   and why extension is unsuitable in the delivery report; this does not require a
   separate approval flow for otherwise authorized local UI work.
5. When Arc provides the missing capability, read its registry documentation and
   reuse the official free/licensed source. Review dependencies and local overrides
   before installation. Do not reconstruct Pro source or import the foundation reset.

### Buttons: one shared presentation contract

`src/shared/ui/Button.tsx` is the application-facing action button. `SecondaryButton`
already delegates to it. New application code must not import the registry Button
directly or define another button's color, padding, border, focus and loading system.

The shared API exposes seven variants. `primary`, `secondary`, `ghost` and `danger`
use the existing Arc action variants. `link`, `item` and `tab` are bycoda adaptations
of Arc's ghost presentation. `link` is a text action, not an anchor for navigation.
`item` fills a row and aligns content to the start; `tab` represents a compact tab.
Both structural variants render direct children without label/width/press animation.
They do not implement roving focus or selection: the existing interaction owner does.

| Prop                       | Contract                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `variant`                  | `primary`, `secondary` (default), `ghost`, `danger`, `link`, `item`, `tab`.                                                                                     |
| `size`                     | Existing Arc `sm` (default), `md`, `lg`; bycoda's shared control-height tokens remain authoritative.                                                            |
| `iconOnly` / `label`       | `iconOnly: true` requires a translated `label` at the type level. It creates a square control and supplies its accessible name and fallback native tooltip.     |
| `tooltip`                  | Translated native tooltip. Explicit native `title` takes precedence. No new floating tooltip owner is created.                                                  |
| `shape`                    | `default` (existing control radius) or `pill`.                                                                                                                  |
| `selected`                 | Optional visual state; otherwise derived from the caller's `aria-selected`, `aria-pressed` or `aria-checked`. It does not invent or change ARIA roles/states.   |
| `loading` / `loadingLabel` | Controlled pending state and optional translated busy accessible name. Remains focusable and blocks duplicate activation and form submission.                   |
| `startIcon` / `endIcon`    | Decorative React nodes; their wrappers are hidden from assistive technology. Existing icon children continue to work.                                           |
| `fullWidth`                | Fill the available inline size. `item` is full width by default.                                                                                                |
| `motion`                   | `auto` (default) or `none`. Structural/text actions and native drag/animation handlers use the native renderer with the same Arc classes and tokens.            |
| Native props / `ref`       | Existing button props, form name/value, data attributes, keyboard/context/drag events and `HTMLButtonElement` ref remain supported. Default `type` is `button`. |

`disabled`, boolean/string `aria-disabled`, and `loading` block click, popup activation,
Enter/Space activation and drop actions in both renderers. Tab/navigation keys remain
available for focusable aria-disabled/loading controls. Drag-end cleanup still runs.
Async state is owned by the feature; Button never automatically executes or retries an
action. SecondaryButton forwards the same API, selecting secondary/danger presentation.

```tsx
<Button variant="primary" type="submit" loading={saving}>{t("Save")}</Button>
<Button variant="ghost" iconOnly label={t("Filters")} selected={hasFilters}
  aria-expanded={filtersOpen} aria-haspopup="dialog" onClick={openFilters}>
  <FilterIcon />
</Button>
<Button variant="item" role="menuitem" onClick={openDetails}>{name}</Button>
<Button variant="tab" role="tab" aria-selected={active} tabIndex={active ? 0 : -1}
  onClick={selectTab}>{title}</Button>
```

The API foundation is implemented; this does not mean legacy screen consumers have
all migrated. Do not create another IconButton or ToolbarButton to access these props.

Existing helpers such as a feature `ToolbarButton` may retain a meaningful behavior
contract, but their visual implementation should delegate to the shared layer when
migrated. Native fallback rendering belongs inside that layer where Motion conflicts
with native events. Shared tokens and state behavior must still apply to the fallback.
Arc composite internals and upstream source are not migration targets merely because
they contain native buttons. Third-party editor/terminal controls retain their owner.

Do not apply a blanket `<button>` replacement or a global CSS rule to make every
interactive element look like an action button. Migrate application consumers by
their role and preserve the existing native window and popup contracts.

### Compact screen composition

- Use one compact header/action row. Reuse existing navigation and panel containers;
  do not add a second page gutter or a dashboard shell around a workbench tool.
- Open collection filters from an icon trigger using the existing Popover. Show an
  active-filter count/state on the trigger. Keep filter values and reset together in
  the popover; an always-visible chip row is not the default. FilterToolbar can be
  composed inside the popover without creating another filter-state owner.
- Keep search compact and expandable on narrow surfaces. Preserve the query when
  the search control or filter popover closes.
- Keep frequent actions visible and move infrequent actions into the existing
  overflow menu. Running/paused state, failures and actions needed for recovery must
  remain apparent; do not conceal them just to reduce visual density.
- Use short visible labels and contextual information controls for optional help.
  Keep field names, destructive confirmation scope and actionable errors explicit.
- Use disclosure for advanced fields and long supporting content without discarding
  hidden form values. Avoid nested decorative cards and repeated explanatory text.
- Use Switch for independently applied on/off preferences; use Checkbox for choices
  submitted with a form. Use InlineEdit only for independently saved values; grouped
  edits continue to use fields and the existing save operation.

### Review before delivery

Check reuse and behavior as well as appearance: no new visual-only duplicate, no
direct registry import in newly changed application consumers, no competing theme
or overlay owner, preserved refs/form behavior and permissions, and no hidden loss
of data or required actions. For shared control changes, check representative consumers
with keyboard input, long labels, loading/disabled/error states, narrow/wide layouts,
light/dark themes and reduced motion. Keep source, browser fixture and installed-app
acceptance as separate claims. Documentation-only edits require documentation checks,
not a new product build or UI test suite.

## Application adapters

- `src/shared/ui/Button.tsx` preserves native button props, defaults to
  `type="button"`, and uses the compact Arc theme. Native drag and animation
  handlers use a native button because Motion reserves those event names.
- `SecondaryButton` keeps its existing public API and delegates to `Button`.
- `TextField` adds the scoped theme to Arc Input and forwards the input ref.
  Use `hideLabel` only when an existing visible label or surrounding context
  supplies the visual hierarchy. The input still has an accessible label.
- Settings `Toggle`, `Slider`, and `Segmented` keep their existing call-site
  contracts. Switch sounds, controlled values, radio semantics and settings
  search ids remain owned by the existing settings layer.
- Settings `Select` and `SearchableSelect` compose Arc Select/Combobox presentation
  while retaining the existing Popover routing, IME, focus and keyboard contracts.
- `MorphSelect` handles small property lists and registers with the shared Escape
  overlay stack. General settings uses it for the stay-awake duration.
- `ExpandableCard` displays Diagnostics measurement details. Closed content stays
  mounted and inert, preserving input state; Escape returns focus to the trigger.
- `Timeline` localizes day headings, counts and announcements. Task attempt history
  keeps worker/reviewer session actions visible outside collapsed review details.
- `TextareaField` forwards native textarea props/ref and scopes the field theme.
  Social bulk composition retains its original validation and policy controls.
- Project group menus use Arc Context Menu row presentation with the existing
  `Popover` and `ExplorerMenu` overlay owners. Appearance, order, privacy,
  workspace and deletion actions live in viewport-aware flyouts. Group deletion
  with projects uses the existing saved-conversation confirmation and keeps
  project folders on disk.

## Appearance and motion

Text-field focus is owned by `src/styles/arc.css`: one 1px outline inset on the
existing border, with the shared danger token for invalid fields. `SearchInput`
defaults to owning this outline. For a bordered composite, use `SearchInputGroup`
and `focusOwner="group"`; for an already framed menu header, use
`focusOwner="menu"`. Clear buttons retain their own keyboard focus indicator.
Feature focus rules must exclude `[data-ui-focus]` instead of overriding this
contract or drawing another outline on the container.

`src/styles/arc.css` defines semantic Arc roles on `.bycoda-arc` control roots.
Colors, fonts, active states, focus and 28/36px heights come from the existing
bycoda appearance tokens. These roles inherit into child controls without
replacing global font, theme, accent or focus behavior.

Do not globally import `arc/foundation.css`: its root theme attributes and focus
reset do not match bycoda's `html.theme-light`, custom accent and overlay model.
Retain it as the upstream token reference. New controls must receive the scoped
theme, including when they are placed in a portal or native popup.

`arc/lib/motion-tokens.ts` applies short transitions, non-bouncing springs and
zero text blur while keeping the upstream token file intact. Components retain
their reduced-motion branches.

## Local source adaptations

Preserve these changes when updating Arc registry source:

| Item              | Local extension                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Switch            | `compact` geometry: 36x20px track, 16px thumb, 28px hit area; restrained stretch and shared motion timing.                 |
| Segmented control | `selectionRole="radio"`, `optionIdPrefix`, stable `data-selected` styling and keyboard navigation from the focused option. |
| Slider            | `hideLabel` retains the accessible label while a settings row owns the visible label.                                      |
| Input             | `fieldClassName` themes the complete field; `hideLabel` preserves the associated accessible label.                         |
| Motion tokens     | The local re-export module owns bycoda timing and blur policy.                                                             |
| Select / Combobox | Export composable native presentation parts for existing overlays.                                                         |
| Morph Select      | Controlled open state, localized labels, short springs and shared overlay registration.                                    |
| Expandable Card   | Existing icon set and guarded ResizeObserver setup.                                                                        |
| Timeline          | Always-visible row actions, localized messages and locale-aware time formatting.                                           |
| Textarea          | `fieldClassName` and `hideLabel` avoid duplicate/nested visible labels.                                                    |

Arc's global overlay implementation is not the default replacement for
`Modal`, `Popover`, `overlay.ts` or native popup routing. Integrate each future
overlay with the existing focus, Escape, layer and window contracts before
migrating its consumers.

## Verification

Source interaction checks live in `arcAdapters.test.ts` and
`settingsControls.test.ts`. The memory-only browser fixture checks geometry,
keyboard interaction, theme changes and narrow-window layout:

```powershell
pnpm exec playwright test --config tests/browser/playwright.arc-controls.config.ts
```

The fixture builds into ignored `temp/build/` and uses port 1442, independently
of the desktop development server. Browser captures and traces stay in ignored
`temp/` locations. Browser fixture acceptance does not establish native popup or
installed desktop acceptance.

## Additional data and action controls

Nine free Arc registry items are installed with the pinned CLI. Their shared adapters
scope appearance to `bycoda-arc`; registry copy is localized through the existing catalogs.

| Item                | Integration                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON viewer         | Complete saved JSON objects/arrays in Tool Inspection. Plain text, diffs, commands and truncated output retain their original presentation. Value/path copying uses the native clipboard bridge.                                        |
| Filter toolbar      | Removable project/tag filters in the Notes library. Existing filter controls and preferences stay authoritative.                                                                                                                        |
| Sortable data table | Usage project rows sort by actual numeric values within each rail group, preserving group totals, token breakdowns, pricing warnings and project path tooltips.                                                                         |
| Date range picker   | Custom inclusive local-day ranges in Usage Overview; fetching starts at the selected start, aggregation excludes rows after the selected end. Existing presets reset the custom range. The popup joins the shared Escape overlay stack. |
| Inline edit         | Session Notes titles save through the existing serialized queue, finalize pending slugs and roll back failed renames.                                                                                                                   |
| Usage meter         | Account quota details retain remaining/used preferences and reset times. Compact meters use the account color and show used/remaining categories.                                                                                       |
| Shortcut recorder   | Keybinding settings retain physical-key capture, IME/global shortcut handling, validation, disable/reset operations and asynchronous errors. Arc provides controlled recording presentation.                                            |
| Confirm morph       | Notes deletion confirms in place and awaits the existing save queue. Failed deletion restores autosave and permits retry. It never adds sending or host approval authority.                                                             |
| Image compare       | Image Lightbox can compare its existing image with an explicitly selected local image. Blob URLs are revoked on replacement, dismissal and source changes. Original zoom/pan resumes when comparison closes.                            |

The new controls are exercised in the existing memory-only Arc browser fixture,
including dark/light themes, narrow widths, keyboard interactions and reduced motion.
No component imports Arc's global foundation reset. Shared focus rules remain in `arc.css`.

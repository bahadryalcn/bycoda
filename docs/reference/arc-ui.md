# Arc UI integration

The shared design policy is [bycoda UI design system](ui-design-system.md).
Use [component selection](ui-component-catalog.md) to choose free Arc capabilities.
This document describes current source contracts. A catalog decision is not a claim
that an official registry item is installed, every consumer has migrated, or an
installed desktop application has passed acceptance.

Arc source is installed with the project-pinned shadcn CLI into `src/shared/ui/arc/`.
`components.json` registers `@uiarc` and maps components to `src/shared/ui`.

```powershell
pnpm exec shadcn add @uiarc/<component>
```

Review the registry item and its dependencies before installing. Do not pass
`--overwrite` to an adapted item without reviewing the local changes below.

## Agent tooling

The repository `.mcp.json` declares Arc's HTTP server for project-aware clients.
Codex uses its own MCP configuration; inspect with `codex mcp get arc --json` and,
when missing, add it with `codex mcp add arc --url https://uiarc.dev/api/mcp`.
The server requires Arc account sign-in, including for free access. Complete
`codex mcp login arc` locally, then start/reconnect a session so its tools load.
Configuration alone does not establish authenticated MCP access. Do not store
tokens or authorization callback URLs in project files or development logs.

Use `search_components`, then compare `get_component` guidance, and request
`get_install_command` before adding missing controls. Pass `tier: "free"` when
searching. If authentication is unavailable, the official public
[catalog](https://uiarc.dev/r/catalog.json), [index](https://uiarc.dev/llms.txt)
and each component's `/markdown` page provide the documented fallback.

The project `.claude/skills/arc/` contains the official free skill and references.
Codex can use the installed `arc` skill from its available skill directories.
Do not overwrite the project's reuse/theme/native contracts with generic Arc
examples. Registry installation uses the pinned project CLI and existing
`components.json`; the product does not need another UI framework dependency.

## Reuse decision rules

The root `AGENTS.md` defines the mandatory UI reuse policy. This guide describes
how to apply it. Existing feature behavior remains authoritative during migration.

First identify the user's task and compare suitable interaction patterns. The old
HTML tag, number of controls and grouping do not prescribe the replacement. A row
of actions may need a segmented choice, radio group, split action or menu; small
stable option lists may use Select, while long/growing searchable lists need
Combobox/autocomplete or searchable MultiSelect. Preserve behavior and capabilities
while improving the interaction. A shared import alone does not prove task fit.

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

The shared API separates hierarchy from semantic intent. `primary`, `secondary`
and `ghost` use Arc action rendering. Legacy `danger` normalizes to secondary with
danger tone. `link`, `item` and `tab` are bycoda adaptations
of Arc's ghost presentation. `link` is a text action, not an anchor for navigation.
`item` fills a row and aligns content to the start; `tab` represents a compact tab.
Both structural variants render direct children without label/width/press animation.
They do not implement roving focus or selection: the existing interaction owner does.

`tone` accepts `neutral`, `accent`, `info`, `success`, `warning` and `danger`;
legacy `error` maps to danger. An explicit tone overrides the legacy variant.
The default remains neutral, including primary. Tone foreground, solid/on-solid,
hover, pressed, border and disabled roles live in the shared theme; info remains
independent of the user's accent. Structural state and native props remain owned
by their existing interactions.

| Prop                       | Contract                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `variant`                  | `primary`, `secondary` (default), `ghost`, `danger`, `link`, `item`, `tab`.                                                                                                    |
| `size`                     | Existing Arc `sm` (default), `md`, `lg`; bycoda's shared control-height tokens remain authoritative.                                                                           |
| `iconOnly` / `label`       | `iconOnly: true` requires a translated `label` at the type level. It creates a square control and supplies its accessible name and fallback native tooltip.                    |
| `tooltip`                  | Translated native tooltip. Explicit native `title` takes precedence. No new floating tooltip owner is created.                                                                 |
| `shortcut`                 | Optional display hint appended to the tooltip. Resolve configurable bindings with `useKeybindingShortcut`; disabled bindings return null. Does not register keyboard handlers. |
| `shape`                    | `default` (existing control radius) or `pill`.                                                                                                                                 |
| `selected`                 | Optional visual state; otherwise derived from the caller's `aria-selected`, `aria-pressed` or `aria-checked`. It does not invent or change ARIA roles/states.                  |
| `loading` / `loadingLabel` | Controlled pending state and optional translated busy accessible name. Remains focusable and blocks duplicate activation and form submission.                                  |
| `startIcon` / `endIcon`    | Decorative React nodes; their wrappers are hidden from assistive technology. Existing icon children continue to work.                                                          |
| `fullWidth`                | Fill the available inline size. `item` is full width by default.                                                                                                               |
| `motion`                   | `auto` (default) or `none`. Structural/text actions and native drag/animation handlers use the native renderer with the same Arc classes and tokens.                           |
| Native props / `ref`       | Existing button props, form name/value, data attributes, keyboard/context/drag events and `HTMLButtonElement` ref remain supported. Default `type` is `button`.                |

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
  Structural item/tab records may opt into `layout="stacked"` for direct multiline
  children. This keeps row geometry in the shared control when layered utility
  display classes would otherwise be overridden by Arc's base inline layout.
  Prose references use `variant="link" layout="text"` to retain the surrounding
  text's baseline, wrapping and line height. This inline mode is for references
  inside sentences; toolbars and standalone actions retain normal control sizing.
- `SecondaryButton` keeps its existing public API and delegates to `Button`.
- `TextField` adds the scoped theme to Arc Input and forwards the input ref.
  Use `hideLabel` only when an existing visible label or surrounding context
  supplies the visual hierarchy. It omits the inner label to avoid nesting;
  a nonempty `label` becomes an accessible-name fallback. Existing native
  `aria-label`/`aria-labelledby` and outer label relationships remain supported.
- Shared `Switch`, `Slider`, `SegmentedControl` and `Select` own generic
  presentation without depending on Settings. Switch forwards native props/ref;
  Slider exposes scalar/range values and `onValueCommit`; SegmentedControl
  defaults to radio semantics. Select uses `onValueChange` and the existing Popover.
  Settings `Toggle`, `Slider`, `Segmented` and `Select` remain compatibility
  facades, keeping sounds, settings search IDs and persistence hints.
- Shared `Select` and `SearchableSelect` compose Arc Select/Combobox presentation
  while retaining the existing Popover routing, IME, focus and keyboard contracts.
- `NativeSelect` (exported from `Select`) and `Checkbox` retain native input
  refs, uncontrolled defaults, required validation, reset and `FormData` for
  existing forms. These are native form owners with shared semantic styling;
  searchable controlled collections still use SearchableSelect. Checkbox also
  supports an indeterminate visual/ARIA state without controlling its value.
- `NativeSearchableSelect` adds searchable presentation to single-value native
  forms. A real select retains `name`, `form`, `required`, native change events,
  controlled `value` or uncontrolled `defaultValue`, reset, disabled option
  metadata and `HTMLSelectElement`
  refs. `options` uses the shared selection metadata. Invalid submission displays
  the browser's validation message and focuses the visible trigger; imperative
  select focus and external labels also route there. Reset synchronization runs
  after the native default action and honors cancelled resets. Social's project,
  account and verified-fact form fields use this bridge. Disabled fields retain
  native omission from FormData; existing explicit edit payload owners remain.
  This is a real select bridge, not hidden-input-only serialization. The six
  initial growing Social form choices were migrated; that count is consumer
  evidence, not a restriction on reuse. checkValidity/reportValidity and custom
  validation messages retain visible recovery feedback and trigger focus.
- `Badge`, `Alert` and `EmptyState` expose adapted official free Arc source through
  application adapters and shared semantic tones. Social retains domain status
  mapping, labels, operation callbacks and recovery actions. Alert supports
  controlled presence/dismissal and native HTMLDivElement ref/attributes;
  EmptyState accepts caller-owned action content. Feature-wide role=alert CSS
  must not override the shared tone, surface or spacing.
  Neither component grants operation authority. Social's native disclosure/modal
  lifecycle remains the owner of mounted drafts and close/focus behavior.
- `SearchableSelect` supports per-option descriptions/disabled metadata,
  locale-specific matching, native `triggerProps`/ref, optional selected values
  and removal/reset/Done labels. SocialMultiSelect retains domain busy state
  and Turkish copy in its feature facade.
- `ExpandingSearch` adapts official free width/radius choreography to controlled
  query and externally ranked results. SettingsSearch retains `searchSettings`
  ordering, localization and deferred setting reveal. Its results use the
  existing Popover; it does not replace filtering or form-value selection.
- `ControlSpecimen` renders real Button, fields, generic choices and a Popover
  with ephemeral local state. Appearance uses the same compact specimen and
  optional tone/state details; its storage keys and preference owners remain.
- `ExpandingButtonGroup` reuses official free choreography with shared Button
  action nodes and guarded async results. Session Notes uses it for Copy,
  Add to chat and conditional Link; deletion and serialized saving retain their
  feature owners. A false/rejected operation never produces success feedback.
- `FloatingButtonGroup` supplies shared action rows and roving keyboard focus
  inside TranscriptSelectionMenu's existing Popover. Terminal delegates to that
  same menu. Selection preservation, dismissal and pending/error/retry remain
  feature-owned. Native Button tooltips avoid another tooltip/overlay dependency.
- ConfirmMorph action nodes delegate to Button with its own label motion off;
  the composite retains hold/countdown/arming, async retry, actual undo and focus.
- `MorphSelect` handles small property lists and registers with the shared Escape
  overlay stack. General settings uses it for the stay-awake duration.
- `ExpandableCard` displays Diagnostics measurement details. Closed content stays
  mounted and inert, preserving input state; Escape returns focus to the trigger.
- `Timeline` localizes day headings, counts and announcements. Task attempt history
  keeps worker/reviewer session actions visible outside collapsed review details.
- `TextareaField` forwards native textarea props/ref and scopes the field theme.
  Social bulk composition retains its original validation and policy controls.
- `NumberField` delegates to TextField with native `type="number"`, keeping
  `min`, `max`, `step`, invalid/empty drafts, native change events and form refs.
  Usage budgets retain their own parsing and save boundary; the adapter does not
  add scrubbing, formatting or coercion on change.
- `PasswordField` adapts the free password reveal interaction through TextField
  and Button. The same native input retains its uncontrolled value, selection,
  ref, autocomplete and validation. Reveal changes its type, never copies a secret
  into React state and never submits the form. Connections uses it for credential
  entry; password-strength rules do not apply to provider tokens.
- `RadioGroup` adapts free native radio rows with optional descriptions and a
  compact layout. Native radios retain name, required validation, disabled options,
  value/defaultValue, change events, keyboard navigation, reset and input refs.
  Social schedule and approval choices retain their feature-owned draft and
  approval-step callbacks.
- `DropdownMenu` provides a controlled single-level action menu through the
  existing Popover and Arc ContextMenuRow. It supports disabled items, separators,
  descriptions, shortcuts, checked state, roving focus, typeahead and Escape focus
  return. Nested ExplorerMenu interactions keep their existing owner. Consumers
  own operation promises, errors and permissions.
- Public `ContextMenu` forwards to `arc/context-menu/native-context-menu.tsx`, the
  extracted ExplorerMenu point/anchor/submenu controller. Feature `ExplorerMenu` is
  a compatibility re-export; native popup and existing Popover routing still own
  placement, focus and dismissal. This is distinct from single-level DropdownMenu.
- Public `MenuRow` delegates the existing private Arc ContextMenuRow and exports
  `menuRowClassName`. It forwards native button refs/events and disabled/submenu
  semantics to existing domain menu controllers; it does not create a menu stack.
- Public `TreeRow` forwards native button props/ref to `arc/tree-view/tree-row.tsx`.
  Controlled `selected`, `cut`, `dropTarget` and finite depth clamped to 0..64
  drive shared density/token presentation. The default role is treeitem with
  aria-level; caller roles/ARIA and events remain supported. FileTree retains
  lazy loading, windowing, multi-selection, rename and coordinate native drops.
- `Progress` uses measured values or an explicit indeterminate state when `value`
  is absent. Caller tones remain independent of completion: exhausted provider
  quota keeps its danger meaning at zero remaining or 100 percent used. `Skeleton`
  reserves pending content and can reveal caller children; outgoing placeholders
  stop announcing loading during their exit. Provider account usage consumes both.
- `TagInput` adapts free tag editing with native draft input refs, IME-safe
  delimiters, blur commit, optional normalization/max tags and keyboard removal.
  Notes retains normalizeNoteTags, persistence and its immediate Backspace removal
  contract. Committed tags are owned by `value`/`onValueChange`; `inputProps.name`
  names only the draft input. Named committed-tag FormData/reset/required semantics
  are not supplied by this adapter and must not be inferred from its input props.
- Project group menus use Arc Context Menu row presentation with the existing
  `Popover` and `ExplorerMenu` overlay owners. Appearance, order, privacy,
  workspace and deletion actions live in viewport-aware flyouts. Group deletion
  with projects uses the existing saved-conversation confirmation and keeps
  project folders on disk.

## Appearance and motion

Text-field focus is owned by `src/styles/arc.css`: one 1px outline inset on the
existing border, with the shared danger token for invalid fields. `SearchInput`
owns this outline by default for `appearance="field"` or `standalone`; an
unframed bare input defaults to the menu owner. For a bordered composite, use `SearchInputGroup`
and `focusOwner="group"`; for an already framed menu header, use
`focusOwner="menu"`. Clear buttons retain their own keyboard focus indicator.
Feature focus rules must exclude `[data-ui-focus]` instead of overriding this
contract or drawing another outline on the container.

Standalone search fields use `SearchInput appearance="field"`; bordered search
compositions use `SearchInputGroup appearance="field"` with an inner
`SearchInput focusOwner="group"`. Shared CSS owns surface, border, radius, height,
font, placeholder, disabled and invalid presentation. Set native `aria-invalid`
on the input; the group uses the same danger border role. Keep visible error or
match-count feedback in the caller. Existing unframed editor/menu inputs can keep
`appearance="bare"` with their explicit focus owner. Consumers supply layout,
not replacement border/background/font/height/focus classes.

SearchInput preserves native props/ref, controlled/uncontrolled values and input
events. Clear uses the native value setter and dispatches input before returning
focus to the same input. Uncontrolled native form reset reads the value after
the browser default action and honors preventDefault; controlled value ownership
stays with the caller. FilePreviewSearch retains its Range/highlight controller,
find shortcuts, IME/options and preview focus recovery around the shared group.

The existing `bycoda.appearancePreferences.v1` record now includes normalized
`controlDensity`: compact (default), comfortable and touch. The root
`data-control-density` selects shared geometry. Compact retains 28/36px
compact/standard heights, comfortable uses 32/40px, and touch uses 44px for
compact/standard controls (48px large). Missing/invalid old values remain compact.
Reading-section reset restores compact and that section's defaults while retaining
fonts and unrelated preferences; no separate density storage key is introduced.

`src/styles/arc.css` defines semantic Arc roles on `.bycoda-arc` control roots.
Colors, fonts, active states, focus and density-dependent geometry come from
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

## Review boundaries

`node scripts/checks/check-ui-boundaries.mjs` compares source/style findings
against explicit owner-reviewed fingerprint decisions. The baseline includes
944 historical component decisions plus reviewed current additions and counted
signal exceptions. It remains in the uncommitted owner review diff. Inventory
counts alone are not approval; the check has no automatic refresh command.
AST/CSS heuristics cannot prove event, permission, native editor or overlay
correctness. Local immutable/conditional/template class recipes and static
ARIA/feedback selectors are tracked; dynamic roles, indirect styles and imported
recipes still need manual review.
Source contracts, mocked browser fixtures, installed Windows/macOS applications
and release acceptance are separate evidence.

## Additional data and action controls

Nine free Arc registry items are installed with the pinned CLI. Their shared adapters
scope appearance to `bycoda-arc`; registry copy is localized through the existing catalogs.

| Item                | Integration                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON viewer         | Complete saved JSON objects/arrays in Tool Inspection. Plain text, diffs, commands and truncated output retain their original presentation. Value/path copying uses the native clipboard bridge.                                               |
| Filter toolbar      | Removable project/tag filters in the Notes library. Existing filter controls and preferences stay authoritative.                                                                                                                               |
| Sortable data table | Usage time, category and session tables sort numeric metrics before pagination. Shared filters retain project/group membership, separate token categories and explicit missing-data/pricing coverage.                                          |
| Date range picker   | DateRangePicker retains inclusive calendar days. DateTimeRangePicker composes it with start/end date-time fields for end-exclusive Usage timestamp ranges, validates min/max bounds before applying, and uses the shared Popover/Escape stack. |
| Inline edit         | Session Notes titles save through the existing serialized queue, finalize pending slugs and roll back failed renames.                                                                                                                          |
| Usage meter         | Account quota details retain remaining/used preferences and reset times. Compact meters use the account color and show used/remaining categories.                                                                                              |
| Shortcut recorder   | Keybinding settings retain physical-key capture, IME/global shortcut handling, validation, disable/reset operations and asynchronous errors. Arc provides controlled recording presentation.                                                   |
| Confirm morph       | Notes deletion confirms in place and awaits the existing save queue. Failed deletion restores autosave and permits retry. It never adds sending or host approval authority.                                                                    |
| Image compare       | Image Lightbox can compare its existing image with an explicitly selected local image. Blob URLs are revoked on replacement, dismissal and source changes. Original zoom/pan resumes when comparison closes.                                   |

The new controls are exercised in the existing memory-only Arc browser fixture,
including dark/light themes, narrow widths, keyboard interactions and reduced motion.
No component imports Arc's global foundation reset. Shared focus rules remain in `arc.css`.

The current native file consumers use single-file selection and immediately
invoke their existing feature callback. `TextField type="file"` preserves the
browser FileList, accept/ref/reset and form ownership. Free FileDropzone/FileUpload
sources own queued item/progress/retry/abort state and do not forward that native
form contract. Those families remain conditional until a concrete consumer needs
that lifecycle; no cancellation or upload authority is invented by UI migration.

Stepper, ElasticSlider and SplitButton now have actual consumers: onboarding
workflow state, Appearance opacity/blur, and Inbox PR merge method respectively.
SplitButton also owns the Commit action cluster: optional `menuDisabled` overrides
only the menu half's native-disabled gate so Amend remains reachable when the
primary Commit is invalid. Omission preserves the primary-disabled behavior.
Loading and explicit group aria-disabled always gate both halves. Menu selection
only calls its explicit onSelect; it never implicitly invokes the primary action.
Stepper completion and navigation remain feature-owned; ElasticSlider is opt-in
for approximate visual adjustments; SplitButton method selection never runs the
primary action. Native confirmation/approval stays with the feature.

`MorphSelect` now accepts exported `MorphSelectItem` option/group records,
`searchable` (default false), `onClose` and native `triggerProps` including ref
and pointer events. Disabled/group keyboard navigation and IME guards remain in
the shared owner. Sessions use it for bounded independent scalar model settings;
service tier, effort and other settings retain their own values and callbacks.
Growing/custom model catalogs retain their search and free-entry controllers.

`SlotText` animates existing formatted strings in Usage overview KPIs. It respects
application motion preference and OS reduced motion, keeps the latest accessible
value through rapid updates, and does not change numeric formatting, units,
estimates or filtering. Streaming transcript values are not SlotText consumers.

Pure placement classes (`absolute`, `fixed`, `sticky`, `static`, `relative`) on
`Button` are honored through the shared components layer. Arc and adapter box
layout stays in that layer so consumer layout utilities can also hide/reveal,
align and place controls. Control shape, color, focus
and disabled/loading presentation remain centralized; this is not a feature skin.

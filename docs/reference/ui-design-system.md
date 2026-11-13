# bycoda UI design system

Read [bycoda design language](DESIGN.md) first for the product's visual and
interaction principles. This document is the detailed implementation policy for
the desktop workbench. Arc supplies component
source and interaction guidance; bycoda owns the application API, compact density,
theme, accessibility, native-window integration and state contracts. Use the free
Arc catalog. Pro source and subscriptions are outside this adoption scope.

See [Arc integration](arc-ui.md) for the **implemented** adapters and local changes,
and [generated component catalog](ui-components.md) for the coverage map. Policies
below apply to new and migrated code. Sections marked **target API** are a migration
specification, not a claim that the props or components already exist.

## Rules checklist for agents

The short form of this document. `AGENTS.md` points here; the sections below explain
each rule.

- Choose controls for the task and Arc use-case guidance, reconsidering complete
  groups. Preserve capabilities, not tag/button counts. Compare segmented/radio
  choices, split actions and menus. Short stable lists may use Select; long, growing
  or name-searchable lists need Combobox/autocomplete; multiple values need
  searchable MultiSelect (target API). Preserve free entry.
- Search `src/shared/ui/`, settings controls and the feature before creating a
  control. Reuse first, extend shared APIs for reusable gaps, and create a shared
  component only for a concrete unmet need. Standard actions use
  `src/shared/ui/Button.tsx` or a delegating wrapper. No screen-specific button
  styling or visual-only IconButton/ToolbarButton/CardAction duplicates; keep color,
  size, shape, focus, disabled and loading presentation centralized.
- Prefer shared TextField, TextareaField, SearchableSelect, settings controls and Arc
  adapters. Registry source belongs under `src/shared/ui/arc/`; application code uses
  adapters. Preserve native props and ref contracts. Tabs, trees, menus, window
  controls and drag targets keep keyboard, selection, focus, drag and native-window
  behavior; do not mechanically replace them with buttons.
- Reuse Popover, Modal, `overlay.ts` and native popup routing. Do not add another
  overlay stack, focus trap, Escape framework or dialog/menu library. Use shared
  appearance/motion tokens, icons and scoped `.bycoda-arc` roles; no global Arc
  foundation imports or copied design systems.
- Use shared semantic color tokens directly in CSS, Tailwind and inline styles. No
  literal hex/RGB/HSL/OKLCH/named colors, arbitrary color utilities, or local
  color-mix/opacity/gradient recipes. Ordinary panels, lists, sidebars and settings
  groups share the canvas (DESIGN.md "Canvas first"); `var(--ui-surface)` is only for
  floating surfaces, the composer, code/terminal viewers and inputs. Use existing
  raised, hover, pressed, selected, text, border and status roles. Define genuinely new roles once in their owning shared theme under
  `src/styles/` (palette.css, index.css, bycoda.css or arc.css), supporting light/dark/
  custom themes. Keep mixing there and preserve neutral surface hues.
- Keep headers/actions compact. Collection filters and advanced options go in
  icon-triggered popovers with active indication and reset. Keep frequent actions
  direct; secondary actions use overflow menus. Icons need accessible names and
  tooltips; hover cannot be the only discovery/operation path.
- Remove repetitive instructions and decorative cards. Optional help uses an
  information control; long details use disclosure. Keep necessary labels, errors,
  operation/approval state and recovery visible. Compactness must retain fields,
  data, functions and drafts.
- Separate sections primarily with spacing and subtle surface tones; retain clear
  input, selection, focus and drag boundaries. Preserve the user's density settings.
  Make pane, task and action ownership readable before reducing containment.
- Preserve state ownership, persistence, validation, async callbacks, permission
  gates and recovery. Restyling grants no new operation authority. Loading controls
  prevent duplicate actions.
- Shared-control changes need representative consumers checked for keyboard use,
  narrow layouts, both themes and reduced motion. Legacy native controls do not
  justify duplicates: within the named feature, migrate affected instances you find
  and leave unrelated screens alone.

## Design direction

Apply the compact, quiet product language in [DESIGN.md](DESIGN.md): content and
the next action lead; alignment, spacing, type and contrast establish hierarchy.
Preserve every capability, necessary label, draft and recovery action. Do not add
oversized headers, eyebrow labels or competing toolbars to a workbench surface.

Keep toolbars and lists compact while reading and form areas have more breathing
room. Use spacing and subtle surface-tone differences before adding boxes or
borders; retain clear input, selection, focus and drag boundaries. This is a
composition rule, not a change to stored density defaults or permission for local
control-size overrides.

Fewer boxes must produce clearer task ownership. Keep independent panes, resize
edges, overlays and editable regions distinguishable at rest through existing
semantic separator/surface roles. Give content, actions and application-wide
status distinct groups. Human task titles lead; model, branch, hashes and other
metadata remain subordinate. Keep safety consequences and recovery visible.
Expanded, selected and drop-target states must not share the same meaning.

Completed ordinary tool/command steps default to a compact summary with details
on demand; active work, failures and pending approvals remain visible. Use one
simple activity-state signal and keep the existing animated figure optional.
These composition rules do not authorize losing exact output or lifecycle state.

Do not wrap a lone ordinary value in an always-rendered disclosure. Keep short
dates/current values inline and show optional diagnostic detail only when it has
meaningful additional content. Preserve necessary error, approval, uncertainty
and recovery information outside optional help. Source tests that enshrine the
old visual hiding rule must change with a deliberate presentation migration.

Keep the existing system font preference, cool neutral surfaces and desktop scale.
Arc's marketing font, 18px control radius, large page gutters and global foundation
reset are not workbench requirements. The scoped bridge in `src/styles/arc.css`
remains authoritative. Do not introduce a second theme or reset.

## Choose the interaction before the component

Migration must reconsider how the user completes the task. The old element type,
number of buttons and arrangement are evidence about existing behavior, not the
required new design. A group of three buttons may become one segmented control,
radio group, split action or menu. Choose the best-fitting free Arc interaction
first, then implement it through a shared bycoda adapter. Shared presentation does
not require every interaction to become an ordinary Button.

For each control cluster, identify its purpose: execute a command, set a value,
switch a view, navigate to a peer panel, filter a collection or confirm a consequence.
Record single/multiple selection, immediate/explicit save, option count and growth,
label length, frequency, discoverability, keyboard/touch behavior and permissions.
Compare suitable Arc candidates and explain why the selected one fits better.

| User task                                           | Preferred interaction                              | Selection reason                                                                                        |
| --------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Two to five short modes of the same data            | SegmentedControl                                   | Visible alternatives and selected state; not three unrelated action buttons                             |
| Peer content panels                                 | Tabs                                               | Named panels with tab navigation, focus and selection semantics                                         |
| A few exclusive form choices                        | RadioGroup                                         | Compare choices before submitting; use RadioCards (target API) when descriptions or consequences matter |
| One frequent action with close alternatives         | SplitButton                                        | Keep the default action direct and make its variants discoverable                                       |
| Several frequently used independent actions         | ButtonGroup or explicit action row                 | Keep genuinely separate commands accessible; hierarchy reflects importance                              |
| Infrequent contextual commands                      | DropdownMenu or ContextMenu                        | Group secondary commands without turning them into mutually exclusive values                            |
| Immediate on/off preference                         | Switch                                             | The new value takes effect now; form choices use Checkbox                                               |
| Short, stable single-choice list                    | Select                                             | Compact selection when scanning is easy and typing provides little benefit                              |
| Long, growing or name-searchable single-choice list | Combobox / autocomplete                            | Type to find a project, model, account, time zone or other named value                                  |
| Several values from a long list                     | Searchable MultiSelect (target API)                | Search, selected-value summary, removal and reset without a crowded checkbox wall                       |
| A few frequently toggled filters                    | ChipGroup (target API) or visible Checkbox choices | Options remain visible when comparison and repeated toggling are useful                                 |

Option count is a guideline, not the entire decision. Two to five short modes and
two to six visible form choices are useful starting ranges. Use Select for a short
list that can be scanned comfortably; default to searchable selection as the list
grows beyond roughly ten items, or sooner for long/unfamiliar names, changing data
or an obvious type-to-find task. Do not add search to a three-item sort-order field
merely for visual sophistication. Conversely, a short current project list is not
proof that its potentially large collection should remain unsearchable.

Distinguish selecting an existing option from entering a new value. A closed-list
Combobox must not silently remove a field's existing custom model/value entry;
use a documented shared autocomplete/free-entry capability when that is the real
contract. Preserve the committed value while typing, cancellation and clear behavior,
required/form submission, async loading/error/no-results and unavailable selections.
Do not remount or replace the interaction as filtered result counts change. Large
remote collections need bounded/paged results and stale-response protection; the
official basic Combobox does not itself provide list virtualization.

A migration review must assess task fit and usability as well as shared imports
and visual consistency. Reducing native tags or retaining the old button count is
not an acceptance criterion. Preserve capabilities and state contracts while
deliberately changing the interaction when a more appropriate component exists.

Include existing custom components in that review: shared handwritten primitives,
feature-local composites and named components inside larger files, including
memo/forwardRef wrappers. A custom component can hide several duplicate controls
even when its consumer contains no native button or input. Inspect its children,
consumers and state contracts before choosing an Arc replacement or shared extension.
Keep genuinely domain-specific orchestration in the feature and centralize its
reusable presentation; moving an entire domain controller into shared UI is not
required to share its controls. Inventory entries must distinguish indexed candidates
from source-reviewed and behavior/browser-verified migrations.

## Search, autocomplete and navigation

Expanding Search is a distinct useful interaction: a compact icon grows into a
search field with grouped results. Both it and a value-picking Combobox may expose
ARIA combobox semantics; the user's task determines the appropriate application
component, not the shared accessibility role or the word autocomplete alone.

| Task                                                                         | Shared interaction direction                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Find a setting, project, document or other destination from a compact header | ExpandingSearch with grouped results, existing ranking and domain navigation callbacks                    |
| Filter the records currently visible                                         | SearchField (target API)/SearchInput, composed with collection filters as needed                          |
| Set an existing form/property value                                          | SearchableSelect/Combobox or MorphSelect according to list size, local/remote data and presentation       |
| Enter a value that may be absent from suggestions                            | Shared autocomplete with an explicit free-entry contract; do not substitute a closed-list picker          |
| Run commands or jump across application areas                                | CommandPalette (target API), preserving the command registry, shortcuts, permissions and navigation owner |

Settings quick-jump now uses shared ExpandingSearch with controlled query and
externally ranked results. It retains searchSettings ordering, translated labels,
keyboard/IME and deferred reveal/focus after close. This deliberate extension
keeps the ranker authoritative; adopting upstream internal filtering would not
preserve that contract. It does not replace form-value selection or full search.

Full project text search still needs its regex/case/include/exclude, cancellation,
result context and pagination/truncation behavior. An expanding launcher may reveal
that workflow; a six-result local quick-search component is not its replacement.
Use recents only where an existing, permitted source provides them. Preserve query
and selected value as separate state where applicable; no fabricated recent data.

Expanding results must join the shared overlay/focus system, remain inside narrow
surfaces, expose loading/no-results/failure/retry and support reduced motion. Their
maximum visible results, virtualized/paged data needs and expansion geometry must
be checked before choosing a launcher instead of an always-visible field.

## Ownership and dependency direction

| Layer                                | Owns                                                                        | May depend on                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/shared/theme/palette.ts`        | Approved literal colors and theme-specific status seeds                     | Color utilities                                                   |
| `src/styles/palette.css`             | Generated palette variables                                                 | Palette generator                                                 |
| `src/styles/index.css`, `bycoda.css` | Semantic roles, type, geometry, appearance and motion tokens                | Palette roles                                                     |
| `src/styles/arc.css`                 | Scoped mapping from bycoda roles to Arc variables and shared focus behavior | Semantic roles                                                    |
| `src/shared/ui/arc/`                 | Reviewed official free source and documented local adaptations              | Arc's internal dependencies                                       |
| `src/shared/ui/`                     | Public controls, semantic presentation and reusable interactions            | Registry source, shared overlay/clipboard/i18n/platform contracts |
| Feature and application UI           | Data, drafts, permission gates, validation, persistence and layout          | Public shared adapters                                            |

Application code must not import registry controls directly. Existing settings
`Toggle`, `Select`, `Slider` and `Segmented` are compatibility facades until their
generic presentation moves into shared UI. Their settings search IDs, persistence
hints and sounds remain in the settings layer. Shared UI must not import settings.

All ordinary button, field, picker, status and overlay presentation belongs in the
shared layer. Feature CSS may position controls, set grid/flex layout, constrain
width and handle domain content. It must not replace their foreground, fill,
border, padding, radius, height, focus, disabled or loading design.

Native elements remain necessary **inside** shared primitives and specialized
composites. Preserve links as links, tabs as tabs, tree/menu keyboard behavior,
native drag targets, window controls, editor input and file-input semantics. When
a feature needs one of these, move its reusable presentation into the owning
shared composite rather than replacing it with a generic action button. Record
the semantic reason and owner in the component reference; a local style preference
is not an exception.

Pane structure: `PaneHeader` (+ `WindowChromeInset`) for pane/tool headers and title rows, `SectionLabel` for group titles, `Surface` for static containers, `Divider` for hairlines, `Sash` for resize edges, `Meter` for bounded measures, `Tabs` for view switching. Features compose these instead of local header rows, eyebrow labels, card recipes, `w-[78px]` spacers, resize-handle recipes, hand-made meter bars and roving-key tab handlers. Feature CSS may add container steps on the documented hooks (`Tabs` `data-tab-part`, `className`) but not restyle the parts.

## Action contract

`Button.tsx` is the only ordinary action presentation owner. Copy, split, async and
confirmation action compositions must delegate to it.
Do not add visual-only IconButton, ToolbarButton or feature-specific action skins.

This contract applies after identifying a control as an action. Radio, segmented,
tab, tree and menu composites retain their own selection/navigation semantics and
shared token presentation; their internal native buttons do not force a redesign
into a row of action Buttons.

### Implemented API: hierarchy and tone

Hierarchy and semantic color are independent:

| Property                 | Values                                                                                                                                                                      | Meaning                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `variant`                | `primary`, `secondary`, `ghost`, `link`                                                                                                                                     | Solid emphasis, outlined action, quiet action, text action                          |
| `tone`                   | `neutral`, `accent`, `info`, `success`, `warning`, `danger`                                                                                                                 | Intent, independent of hierarchy                                                    |
| Compatibility            | `variant="danger"`; `tone="error"`                                                                                                                                          | Normalize to secondary/danger and danger respectively; one style implementation     |
| Structural compatibility | `item`, `tab`                                                                                                                                                               | Existing stable direct-child rendering; interaction owner retains ARIA/roving focus |
| `size`                   | `sm`, `md`, `lg`                                                                                                                                                            | Shared token dimensions, never a local height/padding override                      |
| Other existing props     | `shape`, `iconOnly`, `label`, `tooltip`, `tooltipDetails`, `tooltipSide`, `shortcut`, `disabledReason`, `selected`, `loading`, `loadingLabel`, icons, `fullWidth`, `motion` | Preserve current contracts                                                          |

The shared Button implements the independent tone prop. Existing seven variants
remain compatible; legacy aliases normalize at the public adapter boundary.
Hover and keyboard hints, shortcut key caps and disabled reasons all go through the shared
Tooltip (`tooltip`, `shortcut`, `tooltipDetails`, `disabledReason`); a native `title=` on an
action is drift, and optional rich previews use useHoverCard.
Do not repeat a fully visible label in a hint. Remove plain duplicate hints;
use `tooltipWhen="overflow"` on Button, `when="overflow"` on Tooltip/useTooltip,
or `OverflowTooltip` for text that may be clipped or hidden in an icon-only mode.
These measure the rendered control and descendants on interaction, including
multiline clamps. Extra detail lines and missing shortcuts remain available;
visible shortcut groups use ShortcutKeys or `data-tooltip-shortcut` on their text.
Keep icon explanations, disabled reasons, full paths behind short filenames and
precise times behind relative dates. Accessible names are independent of hints.
OverflowTooltip composes trigger handlers onto its single child without adding a
DOM wrapper, preserving direct-child layout/interaction selectors and refs.
Put the hint on the focus-owning control for keyboard use. A parent hint owns
full-text recovery for its descendants; nested overflow hints defer to it.
Feature-wide migration and installed-application acceptance remain separate work.

```tsx
<Button variant="primary" tone="accent">Save changes</Button>
<Button variant="secondary" tone="warning">Review warning</Button>
<Button variant="ghost" tone="info">Show details</Button>
<Button variant="primary" tone="danger">Delete connection</Button>
```

The implicit tone for existing variants stays visually compatible: primary remains
the current neutral ink-filled action, secondary/ghost/link remain neutral, and
legacy danger remains secondary/danger. An explicit `tone` wins over the legacy
alias. Do not recolor every existing primary action on introduction.

Use `danger` for destructive consequences, `warning` for a real caution requiring
review, `info` for contextual information, and `success` for an actual successful
result. Do not color Cancel red or ordinary Save green. A tone is not permission,
confirmation, or a host operation; none changes the callback's authority.

Primary uses a shared solid fill and readable on-solid ink. Secondary uses a
neutral panel with a shared tone foreground/edge. Ghost/link use shared tone text
and hover/pressed roles. Selected, pending, disabled, hover and focus must be
defined for every supported combination in one place. Status tones must not turn
into generic accent fills when selected.

Preserve native props and refs, `type="button"` by default, `form`/submit behavior,
drag/animation native event fallbacks and translated names. Loading keeps focus,
announces progress and prevents click, keyboard and form activation duplicates.
Features continue to own asynchronous operations; no new implicit persistence.

### Quiet, complete operation feedback

Keep permission, readiness and activity distinct. Domain owners provide evidence,
invalidate stale runtime observations after failed reads, and retain saved permission
separately. Inventory, picker visibility and credentials alone never prove readiness
or activity.

Every asynchronous action exposes pending state on its initiating Button (`loading`)
or on the affected row/card. Track the actual action and target, not a shared busy
flag that makes unrelated actions appear to run. Acquire duplicate-operation guards
before the first await and clear pending on success and failure.

Keep feedback local and stable: do not replace a populated screen with a spinner
during refresh, move controls when progress appears, or repeat the same progress in
a button, footer and toast. Quiet actions retain their visual hierarchy while busy.
A text action with a `startIcon` swaps that icon for the shared spinner in the same
slot and keeps its label visible. A text action without an icon reserves nothing at
rest (no empty gap before the label); while pending it keeps its width and accessible
name with the spinner centered over the label. Icon-only actions replace their icon.
Pass `loading={pending}` in both idle and pending renders; the Button keeps its width
stable in every case.
Keep cancellation available where the operation supports it. Use determinate
progress only when the operation supplies a real total.

Ongoing agent, session, command or task work uses `WorkingIndicator`
(`src/shared/ui/WorkingIndicator.tsx`; `TerminalSpinner` is a compatibility
adapter). The component owns its color (`--color-active`) and size, so every working
signal looks the same. Choose `size="xs" | "sm" | "md"` to match the icon slot it
swaps with (`icon-xs` default, 12/14/16px); never pass text color, width, font-size
or display utilities. `className` is for placement only; toggle visibility on a
wrapper. It is decorative by default, with the surrounding status supplying the
label; pass `label` only when nothing nearby announces the work. Reduced motion and
the decorative-motion preference keep the bars still, and off-screen indicators
pause. Pending Buttons use `loading`, not a WorkingIndicator.

```tsx
<span role="img" aria-label={t("Working")} title={t("Working")}>
  <WorkingIndicator />
</span>
<WorkingIndicator size="sm" label={t("Running checks")} />
```

Success should be evident in the updated content or a concise local confirmation.
Errors stay beside the failed operation with a useful recovery action and preserve
the user's input. Loading, empty, unavailable, disconnected and failed are distinct
states. Do not present a failed refresh as a successful empty result, or use a
global notification as the only feedback for a foreground action.

### Inline actions in rows, tabs and cards

A tab, list row, tree row or card that holds small actions (close, remove, more) is
one item with one highlight. Do not place a separate ghost Button over or beside the
primary control; use `ActionHost` and `InlineAction` from `src/shared/ui/ActionHost.tsx`.

| Part                                                | Contract                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ActionHost` (`selected?`)                          | Paints hover, keyboard focus (`:has(:focus-visible)`) and selection for the whole item. Renders `data-action-host`; `className` sets placement, gap, padding and radius only.                                                                                                                                                                                                                               |
| Primary control                                     | A direct child Button (or one with `data-action-primary`) or `TreeRow` drops its own fills inside a host, keeping its text, focus ring and selected-tab indicator. Feature controllers keep roles, selection, drag and keyboard navigation.                                                                                                                                                                 |
| `InlineAction` (`label`, `reveal?`)                 | Shared Button `inset`: about 20px, small radius, transparent at rest, `--color-selection` hover and `--color-selection-strong` press/open, secondary ink to foreground. It never paints an opaque square over a hovered or selected host.                                                                                                                                                                   |
| Reveal                                              | `reveal="interaction"` (default) shows the action while its host is hovered, focused or selected; keyboard focus, an open menu and pending always show it, and touch input (`hover: none` / `pointer: coarse`) shows it permanently. Use `reveal="always"` for field adornments and chips. Counts, warnings and status are never hidden this way.                                                           |
| Isolation                                           | Pointer down, click, middle click, Enter/Space and drag start on an `InlineAction` do not reach the host, so closing never also selects or drags the item. Middle-click close belongs on the host.                                                                                                                                                                                                          |
| `InlineMoreAction` (`label`, `onOpen`, `expanded?`) | The row's overflow entry: an `InlineAction` with the More glyph, `aria-haspopup="menu"` and optional `aria-expanded`. `onOpen(anchor)` opens the same menu (same target, same permission gates) as right-click and the context-menu key, so touch and pointer users reach it. Use it for secondary actions only; keep frequent actions direct and keep status (counts, Git, connection) visible in the row. |

```tsx
<ActionHost selected={active} onAuxClick={(event) => event.button === 1 && close(tab)}>
  <Button variant="tab" role="tab" aria-selected={active} align="start" onClick={select}>
    <TabLabel truncate="middle" title>
      {tab.title}
    </TabLabel>
  </Button>
  <InlineAction label={t("Close {p0}", { p0: tab.title })} onClick={() => close(tab)}>
    <X aria-hidden />
  </InlineAction>
</ActionHost>
```

Row action hierarchy: one or two frequent actions stay direct (`InlineAction`), secondary ones go to
`InlineMoreAction`, and status, errors that need a decision and retry stay visible in the row.
Reveal-only actions reserve their slot (opacity) so hovering never moves the row's text; the
`data-action-slot="collapse"` slot is the narrow-row exception that takes no width at rest. With a
fine pointer the slot sits over the row's end on hover, keyboard focus, selection or an open menu
when the row marks trailing secondary metadata (a time, a count, an empty gutter) with
`data-action-yield`: that element turns transparent but keeps its box and text, so nothing moves
(`data-action-anchor="end"` aligns the actions to the last line). Never mark status (dots, badges,
Git, connection) as yielding; a row without a yielding element expands the slot instead, and
touch keeps the actions beside the text. A feature list that can be resized below about 10rem may
use a container query to collapse its row actions the same way (terminal list); pane geometry
follows the container, not the window.

Shared adopters: SearchInput clear, PasswordField reveal, TagInput and SearchableSelect
chip removal (`reveal="always"`), and `TreeRow` inside a host. Feature tab strips and
rows migrate in their owning lines.

## Fields and choices

| Need                                    | Rule                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Text or multiline value                 | `TextField` / `TextareaField`; visible label, description/error relationship and forwarded native ref |
| Search                                  | `SearchInput`/`SearchableSelect`; keep query on close; preserve clear, IME and keyboard behavior      |
| Immediate boolean preference            | Shared Switch; settings Toggle delegates and keeps sounds/persistence                                 |
| Form membership or multi-selection      | Checkbox; use mixed state for partial collection selection                                            |
| A few visible exclusive choices         | RadioGroup; RadioCards (target API) only when descriptions materially help                            |
| Short stable exclusive list             | Select when scanning is easy; Combobox for long or searchable lists                                   |
| Several selected options                | MultiSelect (target API), with discoverable removal and reset                                         |
| Same data in a different view           | SegmentedControl for an exclusive filter/display mode; `Tabs` for views or panels of one context      |
| Number, password, tags, file, date/time | Specialized shared adapter; preserve parsing, validation, timezone and native file behavior           |
| One independently saved value           | InlineEdit with explicit pending, failure and recovery                                                |

Do not replace disabled fields with hidden values, discard collapsed drafts or
change controlled/uncontrolled ownership. Associate labels, helper text, validation
and save status without overwriting caller ARIA. Do not use placeholder text as a
label. Required, invalid, readonly, disabled and pending are different states.

Implemented field ownership includes `SearchInput appearance="field"` and
`SearchInputGroup appearance="field"` with `focusOwner="group"`. Surface, border,
radius, density, font, disabled and aria-invalid presentation belong to that shared
owner; callers keep query/options/count/error data and native refs/events. Clear
returns focus to the same input and emits native input; uncontrolled form reset
synchronizes after the default action, including canceled-reset handling. Bare
editor/menu searches retain their explicit native focus owner.

Native menu/tree controllers may use public `MenuRow`, `ContextMenu` and
`TreeRow` rather than duplicate presentation or direct registry imports. MenuRow
forwards the native row contract; ContextMenu preserves extracted ExplorerMenu
point/anchor/submenu/native-popup behavior. TreeRow owns row geometry while
FileTree keeps selection, virtualization, rename and native drop authority.

`SplitButton.menuDisabled` can independently allow menu choices when only the
primary action is disabled (Commit/Amend). Loading and group aria-disabled gate
both. Its default still derives the menu gate from primary disabled. Menu method
selection never implies execution or bypasses a confirmation.
`menuSurface="native"` routes flat choices through the existing Tauri menu API
for short native webviews; the default remains the shared DOM Popover.
`onMenuError` lets the owner show recovery. Display acceptance is not selection
or dismissal: only the native item callback invokes an enabled action, and
`aria-expanded` is omitted when the OS menu lifecycle cannot be observed.

Additional field and choice APIs: `SearchInputGroup size` / `SearchInput fieldSize`
(`sm` toolbar default, `md` form height); `Select` option `disabled` (skipped by
keyboard, a committed disabled value stays visible); `SearchableSelect`
`loading`/`loadingLabel`/`error`/`onRetry`/`retryLabel`/`noOptionsLabel` (presentation
only; callers own fetching); `Segment.disabled`; `TabLabel truncate="middle"`,
`tail`, `title` and `TabDirtyDot`; `MiddleTruncate` (`mode`, `tail`, `title`) for long
paths, branches and model names; TreeRow slots `TreeRowToggle`, `TreeRowIcon`,
`TreeRowLabel` and `TreeRowTrailing`.

Prompt and editor surfaces (task description, automation instructions, quick composer, skill
prompt) use PromptField: the bordered frame owns the single focus ring; the textarea draws none.
The main composer keeps its own implementation for now but follows the same contract
(`data-ui-focus-group`, `data-ui-focus="group"`, `data-ui-focus-quiet`).

Selection owners, smallest first: Select (short stable list) -> MorphSelect (inline property) ->
SearchableSelect (form/long/async/multiple) -> picker kit (custom toolbar/composer pickers).
Popover headers with search use PopoverSearchHeader; never hand-roll a `border-b` search row with
`SearchInput`. Date and time values use `DatePicker` / `TimePicker` / `DateTimePicker` (for date, time or
datetime), not native date inputs.

### Style ownership: caller className sets placement only

Every shared control uses one override contract. Its CSS module pins
`@layer properties, theme, base, components, utilities;` and places only the root's outer
placement (width/inline size, min/max size, margins, `align-self`/`justify-self`,
flex/grid placement) inside `@layer components`. Tailwind utilities passed through
`className`/`fieldClassName` therefore win for placement. Internal presentation
(height, padding, typography, color, border, radius and every interaction state)
stays unlayered and owned by the component, so a caller class cannot reskin it.
Keep `properties` first in that statement: a module sheet can load before
Tailwind's, and an unlisted `properties` layer would then rank above `utilities`,
so Tailwind's `@property` fallback (WebKit without `margin-trim`, Firefox) resets
`translate`, `rotate`, shadow and similar utility variables to their initial values.

- Use explicit APIs for internal changes: `size`, `fieldSize`, `variant`, `tone`,
  `align`, `selected`, `inset`, density and appearance props. Ask the owner for a
  missing variant instead of overriding padding or font size.
- Define each look once, in its component. Do not repeat a control's appearance in a
  feature stylesheet, and do not use `!important` or class merging as a cascade fix.
- Button keeps its long-standing layered box layout (sizing, alignment, icon-only
  dimensions) for existing callers; its presentation is unlayered like the others.
- `src/shared/ui/layerContract.test.ts` checks the module contract; the arc-controls
  fixture section `matrix-placement` checks computed precedence on real controls.

## Semantic color contract

Application controls consume semantic variables. Neither a literal color nor a
`themePalette.hex...`/`--palette-*` reference in a feature creates a semantic role.
Feature-local `color-mix()`, opacity recipes, gradients and Tailwind color/opacity
utilities must not invent a control's appearance.

| Role                                     | Current owner and consumption                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Base, panel, raised, muted               | `--color-background-base`, `--ui-surface`, `--ui-surface-raised`, `--ui-surface-muted`                 |
| Hover, pressed, selected                 | `--ui-surface-hover`, `--ui-surface-pressed`, `--ui-surface-selected`                                  |
| Primary, secondary, muted, disabled text | `--color-content`, `--ui-text-secondary`, `--ui-text-muted`, `--ui-text-disabled`                      |
| Structural edge and focus                | `--color-stroke`, `--ui-focus-width`, `--ui-focus-offset`; shared focus owns its color                 |
| User accent                              | `--user-accent-color`, `--user-accent-foreground`, with existing fallbacks                             |
| Semantic status                          | `--color-info`, `--color-success`, `--color-warning`, `--color-danger`; `--color-error` aliases danger |
| Running/on                               | Existing `--color-active` and control tokens; preserve its distinction from the user accent            |

Each action tone has foreground, subtle surface, solid surface, on-solid ink,
border, hover, pressed and disabled roles in the shared theme. Button consumes
`--ui-tone-{tone}-*` through its adapter. The scoped Arc info bridge stays distinct
from the user accent.

### Theme and interaction ownership

Workspace canvases use `--ui-workspace-canvas` and navigation panes use
`--ui-workspace-panel`. Both retain their opaque theme roles until dark native
glass and Main pane glass are effective; then the owning `.body-glass` paints
the user's opacity once and child canvases stay clear. The app root must not
add a second translucent fill. Sidebar opacity remains independently owned.

Navigation chrome, quiet cards and selected-row layers use the
central `--ui-navigation-*` roles. Their glass gate follows dark native window
glass independently of Main pane glass. Navigation tab strips inside an existing
sidebar canvas stay clear; an outer title bar owns its canvas fill, while a title
bar nested inside a painted pane does not paint the opacity again. Bounded
status chips, code fragments and field focus/press states retain their readable
semantic fills. `ButtonGroup surface="navigation"` paints no fill: joined navigation
tools share their bar's ground in every theme and keep only the group outline;
callers do not restyle the primitive locally.

Opt-in workspace artwork is separate from native window glass and the saved
Pure/Tinted canvas choice. `has-workspace-background` paints one root image through
the shared safe gradient serializer and a theme-derived readability veil. Pane
canvases expose that image; reading and control surfaces retain their semantic
fills. Preview swatches use the same composition with local image/strength values.
Project/chat images and live scenes keep their existing higher layers and opacity
ownership. Reduced transparency and forced colors explicitly remove artwork while
retaining the saved design; browsers need not implement a positive accessibility
media query to display the normal background. Independent popups keep their own
background contract.

Reading regions use `--ui-workspace-reading` instead of clearing their background.
Sticky text and overlapping panels must occlude content underneath: retain their
opaque semantic tone or use the shared floating role. Verify actual scrolled
content before applying translucency to an overlap boundary. The `-reading-base`, `-reading-chat`, `-reading-panel`
and `-reading-muted` variants,
and `-canvas-muted`, `-canvas-chat` and `-canvas-surface` variants, preserve the
original opaque tone of existing consumers. These roles are defined only in
`src/styles/index.css`; reduced transparency and forced colors restore opaque
fills with selectors at least as specific as the glass selectors. Ordinary
fields, floating overlays, status/diff marks and embedded document, browser,
device or media pixels keep their own roles. Native effect success is separate
from renderer styling; a failed effect retains an opaque canvas and exposes
local retry rather than claiming glass is active.

The palette supplies base seeds; `index.css` and `bycoda.css` derive the shared
surface, text, state, geometry and motion roles, and `arc.css` maps them into
scoped Arc controls. Appearance applies the saved theme and custom accent to the
document. The accent foreground is chosen for the applied accent; it is not a
replacement for the palette's status or running/on colors. Keep saved custom
colors, tint, contrast and density preferences intact. An immediate preview is
not evidence that a preference was durably saved.

Use the shared control height, compact height, large height and radius tokens
instead of per-feature control metrics. The Arc small and medium heights map to
the compact and regular control heights. Comfortable and touch density override
those heights and related targets; do not hard-code a single density in a
consumer. Keep labels and touch targets usable alongside the visible control.

`--color-background-base` is the canvas; `--ui-surface-panel` separates navigation,
`--ui-surface` carries reading/forms, and `--ui-surface-raised` carries floating
content. Dark layers become lighter as they rise; light layers rise towards paper.
`--bycoda-panel` and `--bycoda-raised` delegate to those roles. Pane edges use
`--ui-pane-border`, while input boundaries use `--ui-control-border`; both remain
separate from the stronger focus cue. Structural edges follow the contrast
preference. Toolbar/list density and reading/form geometry keep their existing
owners and saved values.

`--ui-interaction-accent` follows the saved accent. Solid accent actions use its
exact foreground pair; `--ui-interaction-ink` moves extreme custom colors towards
readable theme ink for focus, selected fills and navigation markers. General text
selection uses the opaque accent/foreground pair. Composer and Markdown overlay
editors use `--ui-overlay-selection-background` and preserve transparent glyphs;
CodeMirror, PDF and terminal keep their specific selection adapters. Windows
forced-colors uses system focus/selection colors and leaves disabled choices to
the system. A new consumer should use the shared role rather than copying its
mixing formula.

Status foregrounds use `--ui-tone-{info,success,warning,danger}-fg`. On brighter
custom dark canvases, their ink becomes lighter and their subtle surfaces become
deeper, retaining the status hue and readable text. Light status ink becomes
slightly deeper. Solid status actions keep the existing palette and on-solid
pair; running/on colors remain separate. Arc fields, alerts and status controls
consume these foreground roles rather than treating a solid palette seed as
readable text on every surface.

| Interaction          | Contract                                                                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hover and press      | Transient feedback uses shared surface or tone hover/pressed roles; it does not represent a saved choice.                                                                                                                                                                                       |
| Selected and checked | Use selection roles for selected content and the control's on/mixed semantics for membership. Checkbox, switch, radio and segmented controls retain their distinct native or ARIA state.                                                                                                        |
| Keyboard focus       | One contract (see "Global tokens"): fields turn the border to `--ui-field-border-focus` and add the 2px accent `--ui-focus-ring`; other controls use the shared outline. Independent of hover and selection. Preserve visible focus in forced-colors mode.                                      |
| Disabled and pending | One disabled model (see "Global tokens"); disabled roles communicate unavailable actions; pending retains the operation's label and state and prevents duplicate submission where appropriate. Do not treat either as selection.                                                                |
| Accent               | Opt into the accent tone for intended actions; neutral primary actions remain neutral. Message and composer selection styling are separate consumers. Changing the accent must not recolor status, diff or running meaning.                                                                     |
| Text selection       | General document, composer, editor, PDF and terminal selections have different owners. Preserve the composer's transparent text/highlight layer and the PDF text layer when changing shared selection roles; verify actual rendered selection rather than assuming all consumers use one token. |

Menu and other shared adapters should consume semantic hover, pressed and destructive
roles from the theme. If a required role is missing, coordinate it with the
theme owner rather than adding a local color recipe. Preserve native and custom
theme behavior and test representative controls and consumers in both themes,
including keyboard focus, selection, disabled/pending, custom accent extremes,
and forced colors. These are acceptance checks, not claims of current coverage.

Both themes and custom accents require readable text and visible controls. Target
4.5:1 normal text, 3:1 large text and 3:1 essential control boundaries/indicators
against adjacent colors. Test composited values on real backgrounds, including
glass. Hue/saturation/lightness and contrast preferences must not make meaning or
focus disappear. Status includes a label/icon, never color alone. External brand
marks, content imagery, syntax and diff data use their existing distinct shared
contracts, not UI status colors.

## Global tokens

Tokens are defined once in their owner (`src/styles/index.css`, `bycoda.css`, `arc.css`) and
consumed by name. Do not copy a value into feature CSS.

- Focus contract (owner: top of `src/styles/arc.css`): a focused field frame turns its border to
  `--ui-field-border-focus` (readability-adjusted accent ink) and adds `--ui-focus-ring`, a 2px ring
  in the user's accent at low alpha; invalid fields use the danger border with
  `--ui-focus-ring-invalid`; non-field controls use the outline set by `--ui-focus-ring-color`,
  `--ui-focus-width` and `--ui-focus-offset`. No field uses an inset outline. Composites mark the
  bordered frame `data-ui-focus-group` and the inner editor `data-ui-focus="group"`;
  `data-ui-focus="input"` is a standalone editor that owns its frame and `data-ui-focus="menu"` an
  editor inside a framed menu. `data-ui-focus-quiet` on a group opts a writing surface (the chat
  composer) out of the ring; forced-colors outlines still apply. Feature CSS never draws another
  outline on these containers.
- Disabled: fields, rows and composite surfaces dim with `--ui-disabled-opacity`; buttons and
  filled actions use `--ui-tone-<tone>-disabled-fg|surface|border`. Never both on one element;
  the reason goes in the shared Tooltip (`disabledReason`).
- Layers: `--layer-hover-card|popover|submenu|dialog|dialog-popover|toast|drag` on `:root`
  mirror `LAYER` in `src/shared/lib/layers.ts` (keep both identical). CSS uses
  `z-index: var(--layer-*)`, TS uses `LAYER.*`; no literal z-index above 10.
- Motion: `--motion-duration-instant|fast|standard|slow` (80/120/160/260ms) and
  `--motion-ease-standard|enter|exit`. Arc's `--duration-*`/`--ease-*` point at them. Feature CSS
  uses the tokens, not literal milliseconds or `cubic-bezier(0.22, 1, 0.36, 1)`. Tailwind
  `animate-spin`/`animate-pulse` become a slow opacity pulse under reduced motion globally.
- Status utilities: `text-|border-|outline-|fill-|stroke-|ring-danger|warning|success|info|accent`
  resolve to `--ui-tone-<tone>-fg`, `bg-<tone>` to `--ui-tone-<tone>-solid`. Raw hues stay
  available as `var(--color-danger)` etc. for derivations only.
- Neutral translucent fills: `--ui-fill-faint|subtle|muted|strong` (content ink at 4/8/10/12%
  over transparent) for hairlines, quiet wells and chips; opaque steps keep `--ui-surface-*`.
- Arc scale outside Arc: `--radius-control|panel|surface|pill`, `--space-1..16` and `--accent`
  are global with Arc's values. `--control-height-*`, `--surface*` and `--border*` stay
  Arc-scoped (density/scope specific); outside Arc use `--ui-control-height-*`, `--ui-surface-*`
  and `--color-stroke`/`--ui-pane-border`. `--ui-radius-control` and `--ui-radius-panel` alias
  `--ui-control-radius` and `--ui-radius-card`.
- Floating container role: `--ui-surface-floating` is the one surface for dialogs, sheets,
  popovers, menus, tooltips, toasts and floating panels. Tinted canvases keep the raised step; the
  Pure background maps it near the pure ground (the pane border and floating elevation separate
  it) and controls inside keep their own steps.
- Layer ground and lift: derived layers (surfaces, fields, hover and selected steps, group
  borders) mix from `--ui-layer-base`, the tint ground floored at the default depth, so a fully
  black canvas (Depth 0) keeps its steps. `--appearance-layer-strength` (Appearance -> Surface
  contrast, 50-200%, default 1) scales how far they lift. Painted canvases keep `--ui-tint-base`.
- Card role: `--ui-card-surface` and `--ui-card-border` are the one grouped-card fill and frame
  (`Surface variant="card"`, `FieldGroup variant="card"`, settings groups). The fill is transparent
  on tinted and light canvases and a faint ink step on the pure dark canvas.
- Shared structure: cards use `Surface`; a named group of controls uses `FieldGroup` (never a raw
  `fieldset`/`legend`); titles use `Heading` with the role `page` (16px), `section` (14px),
  `item` (13px) or `caption` (12px, compact windows and dense tool headers), and `SectionLabel` for a quiet caption; local files use `FileField` (never a text
  input with `type="file"`). Helper text uses the muted text role, one step below the label size.
- Pure and Tinted background (Appearance -> Themes -> Background tone, `html[data-canvas-background]`):
  Pure is the default and paints the shared canvas pure black or white for every palette. Derived
  layers still mix from `--ui-tint-base`. Pure paints `--color-background-base` and `--ui-chat-canvas` from `--palette-canvasPureDark` / `--palette-canvasPureLight`; the Pure composer writing area uses `--ui-composer-surface` (one step above that ground). Tokens and components must read well on both; do not
  hard-code a canvas colour or test only one background.

## Type, density and layout

Use the shared interface and code font variables. Product labels/body use 400 or
500; remove local 520/550/600 emphasis as each surface migrates. Keep changing
numbers tabular. New type roles must be shared tokens; do not scatter arbitrary
font sizes or enforce Arc marketing headings in the workbench.

### Type scale

Roles are `:root` tokens in `src/styles/index.css` and Tailwind utilities from its
`@theme` block. Existing `--ui-font-caption` (12px) and `--ui-font-secondary` (13px)
keep their values; the rest are additive. Utilities set size and line height together.

| Role      | Token                 | Size | Line | Utility             |
| --------- | --------------------- | ---- | ---- | ------------------- |
| micro     | `--ui-font-micro`     | 11px | 16px | `text-ui-micro`     |
| caption   | `--ui-font-caption`   | 12px | 16px | `text-ui-caption`   |
| secondary | `--ui-font-secondary` | 13px | 18px | `text-ui-secondary` |
| body      | `--ui-font-body`      | 14px | 20px | `text-ui-body`      |
| title     | `--ui-font-title`     | 16px | 24px | `text-ui-title`     |
| heading   | `--ui-font-heading`   | 20px | 28px | `text-ui-heading`   |

Mechanical migration of ad-hoc sizes:

| Found                                                       | Use                 |
| ----------------------------------------------------------- | ------------------- |
| `text-[9px]`, `[10px]`, `[10.5px]`, `[11px]`                | `text-ui-micro`     |
| `text-[12px]`, `text-xs`, `text-(length:--ui-font-caption)` | `text-ui-caption`   |
| `text-[13px]`, `text-(length:--ui-font-secondary)`          | `text-ui-secondary` |
| `text-[14px]`, `text-sm`                                    | `text-ui-body`      |
| `text-[15px]`, `[16px]`, `text-base`                        | `text-ui-title`     |
| `text-[17px]`..`[20px]`, `text-lg`/`xl`                     | `text-ui-heading`   |

Larger display sizes (welcome, brand) stay local to their theme class. Weights are 400
and 500 only: replace `font-semibold`/`font-bold`/520/550/560/600/650 with
`font-medium` unless the surface is a code or diff marker.

### Icon scale

| Token / utility            | Size | Replaces   |
| -------------------------- | ---- | ---------- |
| `--ui-icon-xs` / `icon-xs` | 12px | `size-3`   |
| `--ui-icon-sm` / `icon-sm` | 14px | `size-3.5` |
| `--ui-icon-md` / `icon-md` | 16px | `size-4`   |
| `--ui-icon-lg` / `icon-lg` | 20px | `size-5`   |

The single stroke is `--ui-icon-stroke` (1.75); pass `strokeWidth={1.75}` for 1.5, 1.75 and
1.9 alike (use 2 only for tiny check/close marks at 12px). Icons inside shared Button keep
the Button's `1em` sizing; do not add a size class there. `icons.tsx` `wrap()` defaults to `size=24, strokeWidth=1.75`.

### Floating surfaces

Popover, Modal, Select, Menu and Combobox share `--ui-radius-popup` (12px),
`--ui-elevation-floating` (light and dark variants), `border-stroke` and
`--ui-overlay-backdrop`. Replace `rounded-xl/2xl`, `shadow-xl/2xl`, `border-content/10`
and `bg-scrim/40` on those surfaces with these tokens.

The shared control-density preference lives in `appearancePreferences` and uses
the existing versioned preference record. Missing or invalid values normalize to
`compact`, preserving 28px compact and 36px standard controls at default scale.
`comfortable` uses 32px/40px; `touch` uses 44px compact/standard and 48px large
controls. This is the implemented `controlDensity` field in the existing
`bycoda.appearancePreferences.v1` record, not a second preference key.
Appearance applies the preference through `data-control-density` on the document
root, and shared theme tokens own the geometry. Reading-settings reset restores
compact density without clearing fonts or unrelated layout preferences.
Use the 4px spacing rhythm for new layout roles; normalize the legacy Arc bridge's
6/10/14px spacing centrally after geometry checks, not screen by screen. Touch
contexts need at least a 44px interactive target through the shared density layer;
specialized native rows and checkbox labels need their own target-size review.
Do not widen every desktop toolbar merely to satisfy a mobile example.

Align headings, fields and lists. Use one content gutter, logical properties and
`min-inline-size: 0` for shrinking content. Bound tables, logs, long forms and
payloads inside their surface. Overflow must not hide recovery actions. Collection
filters live in named icon-triggered popovers, with an active indicator and reset
inside. Frequent actions remain visible; secondary actions use the shared menu.

Settings pages fill the available panel width through `BycodaSettings.css`;
do not add a page-local form width cap. Independent topic cards use intrinsic
columns and shared heading/content tracks so siblings in one row align at both
edges. Keep long editors and tables across the available columns. Card bodies
need a consistent inset, including helper text and empty states.
The policies screen uses document navigation beside an inline reader, with privacy
selected initially. The reader owns its scroll region; the settings shell stays
fixed. At narrow widths the navigation moves above the reader.
Limits and budgets are available directly in settings navigation and through the
Usage limits view; both reuse the same quota and budget owners.

### Settings row contract

Owner of the contract: `src/features/settings/ui/settingsControls.tsx` (Group, Row,
AdvancedSettings, PageHeader) with `BycodaSettings.css` / `SettingsCollection.css`.
Pages compose these; they never reskin them or add page-local surfaces.

- **Group frame (owner decision 2026-10-31, V3-013):** a heading above a thin-bordered,
  rounded frame; rows separated by hairline dividers; no gray fill. One gap between
  groups (`--settings-group-gap`), one row padding (10px/16px), one minimum row height.
  Surface and divider roles are `--ui-settings-group-*` / `--ui-settings-hairline` /
  `--ui-settings-row-hover` in `src/styles/index.css`. Children are Rows and a closing
  AdvancedSettings; other content goes in a `stacked` Row. Collections use the same frame.
- **Row text:** title plus `description` as one short muted line (visible by default).
  Use `info` (ⓘ) only for long or rare detail. `descriptionVisible={false}` keeps the old
  info-popover presentation for a row that has not been shortened yet. Do not show the same
  help twice (description and ⓘ), and state scope once per page or group.
- **Right column:** the control sits on the row's right edge at the density-aware compact
  height; a Select has a fixed minimum width; Slider has a fixed width plus a value chip.
  Wide editors use `stacked`.
- **Dependent sub-rows:** `dependsOn={parentValue}` indents the row; `false` dims it and makes
  its controls inert. `disabledReason` is the tooltip text (and read by assistive technology);
  `Row` shows it through the shared tooltip hook, spread on the row itself with no wrapper element
  (the `.settings-group-content > .settings-row` sibling selectors need a direct child). Never use a
  native `title` on a row.
  Never repeat "Enable X to use this option. Your choice is preserved." as visible text.
  `disabled` gives the same dim/inert state without the indent.
- **Reset:** `modified` + `onReset` on a Row or Group shows a small reset icon next to the title
  only while the value differs from the default ("Restore default" tooltip/name). Remove text
  reset links; keep one page-level action.
- **Page-level Restore defaults:** a page calls `useSettingsPageReset(handler)` (or the shell
  supplies one, as for Appearance); the settings header then shows one "Restore defaults" icon
  that always asks for confirmation and affects only that page. No handler, no action.
- **Interface scale and time:** interface scale is a Slider that applies on release (zoom reflows
  the window, so a live drag would move the thumb under the pointer). The daily summary time is
  `TimePicker`; the stored value can be any valid minute.
- **Tile choices:** one exclusive choice shown as tiles (Appearance mode, onboarding mode and crew) uses
  `RadioTiles` (`src/features/settings/ui/RadioTiles.tsx`); the selected tile gets `--ui-border-accent`.
- **AdvancedSettings:** a disclosure row with the same title x as row titles, chevron on the
  right, at the end of its group. It is closed by default; pass `defaultOpen` only for a disclosure that must start
  open. Never use it to hold only a paragraph.

## Overlays, focus and motion

`Modal`, `Popover`, `overlay.ts` and native popup routing own layering, Escape,
focus entry/return and window boundaries. Arc Dialog/Drawer/Menu/Tooltip visuals
must join this system; installing them does not authorize another focus trap,
global key handler or modal owner.

Keep one focus owner. `SearchInput` uses `input`, `group` or `menu` ownership as
documented in [Arc integration](arc-ui.md). Features must not add nested outlines.
All keyboard focus remains visible, including forced-colors mode. An icon action
needs a translated accessible name and a tooltip; essential help and errors are
reachable without hover. Navigation, tabs, menus and trees keep their native ARIA
and keyboard contracts.

Motion explains a state change. Use shared tokens and stable keys, respect reduced
motion, and avoid width morphing on hundreds of repeated controls. Structural
rows/tabs can use the shared stable rendering mode. No decorative entrances,
blur/glow or layout movement just to demonstrate a library component.

### Feedback and overlay primitives

- Toasts: one stack per corner (`ToastRegion`). Never position a notice with `fixed` and an
  offset, never report heights between notices; render `<Toast>` or wrap a custom card in
  `<ToastSlot>`. Every toast uses the one card (`ToastCard`: tone glyph, title, description, one
  pill action, dismiss) and the stack owns its motion: the newest toast sits in front, three
  show at once, and hover or keyboard focus fans the stack out and holds expiry. Feature cards
  in a `ToastSlot` stay whole next to the window edge and never tuck into the stack.
- Sheets: `Sheet` for every side or bottom panel. Modal sheets trap focus; non-modal sheets
  are `role="dialog"` without `aria-modal` and keep Escape scoped to their pane or the overlay
  stack. No hand-rolled `role="dialog"` overlays with their own Escape or focus handling.
- Destructive confirmation: ConfirmDialog with filled danger confirm, focus on Cancel; add
  `consequences` for what is lost/kept, `requireText` for irreversible bulk loss, `acknowledge`
  for an extra choice. Row deletes stay ConfirmMorph.
- Dialog actions: `ModalActions` (leading destructive at the start edge, Cancel then primary at
  the end). No per-dialog `flex justify-end gap-2` rows.
- Errors in a row or form: InlineError. Empty list rows: `EmptyState size="inline"`.
- Raw command, Host or transport error text: never in a banner, toolbar or row, and never behind
  an inline `Disclosure`. Show a plain sentence and put the raw text behind `ErrorDetails` (a
  popover with Copy); in a row use `DetailedInlineError`, which shows a short single line as written.
  Loading lines: `LoadingText`. Pending glyphs: `Spinner` only.

## Contextual groups and morph interactions

`src/shared/ui/ButtonGroup.tsx` joins related neutral Buttons into one surface
with shared hover and press feedback. Each child remains an independent Button
with its own accessible name, keyboard focus, tooltip and async state. Use it for
a compact action strip such as repository/open, dismiss and update; use an
ordinary action row when separate button surfaces are appropriate. It adds no
selection, menu, overlay or roving-focus behavior. Group geometry lives in
`ButtonGroup.module.css`; child presentation remains owned by `Button.module.css`.

Expanding/floating groups and morph controls are valid workbench choices when they
clarify actions or state. Evaluate them deliberately alongside ordinary controls;
do not reject a useful interaction merely because it animates. Their visual and
behavioral contracts still belong in shared UI and the existing theme/overlay system.

| Pattern                | Intended use                                                                              | Workbench integration                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FloatingButtonGroup    | A named contextual toolbar for text/object selection or a canvas                          | Adopt first inside the existing transcript selection Popover; terminal selection already composes that feature. The group does not own positioning or a new overlay.                               |
| ExpandingButtonGroup   | A compact row of several familiar commands whose labels expand on pointer/keyboard intent | Evaluate Notes editor Copy/Add to chat/Link actions and transcript turn actions. This is not an overflow menu or a selector. Keep frequent/default actions discoverable.                           |
| MorphSelect            | One known scalar property, including a bounded grouped/searchable local list              | Extend the existing adapter when icons/meta/groups/search help. Do not replace custom-entry autocomplete, huge remote collections, multi-selection or several independent settings with one value. |
| ConfirmMorph           | A concise in-place confirmation/result flow already appropriate to the operation          | Reuse the existing adapter and domain save/delete queue. Preserve current confirmation/approval semantics and actual retry/undo capability.                                                        |
| IconMorph (target API) | An existing control's icon changes with a real state                                      | A decorative glyph inside the shared action, for example Copy to check. It must not add another button, accessible name or side effect.                                                            |
| TextMorph (target API) | A few short, infrequently changing state words                                            | Reuse existing Button label motion first; apply independently only where it adds information without double animation or duplicate announcements.                                                  |

Official MorphSelect supports optional local search, groups, icons/meta and disabled
options. The current bycoda adapter exposes a flat option list and explicitly sets
`searchable={false}`. Treat that as an adapter capability gap, not evidence that the
Arc interaction is limited to tiny unsearchable lists. Extend the API deliberately
while retaining controlled open state, overlay registration, focus return, i18n and
the shared appearance. SearchableSelect remains the existing general selection owner.

Official group source has its own native/motion action nodes. Before adoption,
reconcile those nodes with Button's shared action rendering, tones, dimensions,
focus, loading and native event contracts. Extend a shared action rendering hook
only if required; do not create a feature-specific parallel button skin. Keep the
official group's useful choreography and keyboard model rather than rebuilding
an approximation from scratch. IconMorph (target API) itself is an SVG renderer, not a control.

The floating group's callbacks are synchronous in its public API and it does not
provide the application's pending/error lifecycle. Preserve async guards and error
recovery from the consumer. The expanding group awaits returned promises and can
show a done label; rejection/false suppresses success but does not replace a visible
error/retry surface. Do not announce success merely because a menu opened or a
promise was started. Preserve any broader domain-level busy/exclusion rule.

Check keyboard expansion/navigation, icon names, focus-visible and touch behavior.
In the official expanding group a collapsed touch action first reveals its label
and executes on a later tap; a currently expanded item can execute immediately.
Use an appropriate direct action for urgent Stop/Cancel or always-visible recovery.
Fit the full expansion at narrow widths and long translations. While a nested
popover is open, its anchor geometry must remain stable; preserve text selection
and editor/composer caret when actions currently prevent pointer focus transfer.

Use reduced-motion final states, shared timing/tone tokens, stable labels and one
continuous transition. Reserve dimensions where moving neighbors would obscure
content or move a popup. Avoid per-letter/per-item observers across every row or
code block in large transcripts. Morph is a delivery choice, not a reason to add
new actions, publishing authority or confirmation behavior. Pro morph components
remain outside the owner's free-only scope.

## Appearance as the design-system editor

Keep existing theme mode/system preference, accent, tint/lightness, contrast,
fonts/code size, scale, glass, background effects, chat width/wrap and layout
settings. Preserve storage keys, sync/backup behavior and normalization defaults.
Changes to shared presentation must not reset these preferences.

Appearance now uses real shared control specimens, compact preference groups and
scoped resets. Existing storage/default/sync owners remain. The following contract
is retained below as historical design input while consumer and acceptance work
is reconciled. Its always-visible advanced-fields requirement differs from the
Appearance feature's later source-delivery record, which describes custom colors
under a closed Advanced row. This is an unresolved design/source documentation
difference, not permission to change product behavior during a documentation edit.
Check the current Appearance source and attributable owner decisions before
changing disclosure placement; preserve fields, values and deep-link reveal.
The general `AdvancedSettings` component contract above describes its API/defaults,
not evidence that this historical Appearance requirement was accepted or superseded.

Historical Appearance requirement:

1. Group theme/color, typography, density/accessibility and background/layout
   settings into compact, always-visible sections with per-section reset. Settings
   preferences, including advanced fields, must not require expanding a disclosure.
   Use shared rows, aligned controls and content previews to keep open sections scannable.
2. Render a live specimen from the **actual** Button, fields, selection, status and
   overlay adapters. Remove separately painted preview controls and local color
   recipes. Distinguish a preview from an operation on user data.
3. Show neutral/accent/info/success/warning/danger in normal, selected, invalid,
   disabled and pending states. Keep status meaning stable under accent changes.
4. Keep the implemented compact/comfortable/touch density on shared size tokens.
   Normalize old/missing values to compact; preserve existing record/version and
   scoped reset behavior as consumers are reviewed.
5. Validate contrast for custom accents and extreme existing theme/contrast values.
   Derive accessible on-solid ink and shared fallback roles; expose a clear recovery
   action for an unreadable custom combination. Do not add arbitrary per-widget colors.
6. Verify preference persistence, reset, live preview and remote sync/backup, plus
   light/dark/system, neutral/saturated accent, narrow/wide and reduced motion.

Density is implemented, including persistence and Reading-section reset. No new
standalone density key was added. Remaining specialized geometry still requires
its own native/editor target review; this does not postpone the actual preference
or establish installed-application acceptance.
Source/browser verification does not establish installed native acceptance or
complete contrast coverage for extreme custom themes and glass compositing.

## Component delivery and migration acceptance

Before introducing a control: read the shared API, search existing consumers, then
consult Arc `whenToUse`/`whenNotToUse`, accessibility, performance and install
metadata. Reuse, extend, then add a shared adapter only for an unmet requirement.
Review registry dependencies and existing adaptations before a pinned CLI install.
No bulk `--overwrite`, no global foundation import, no direct feature consumption.

Each migration wave must record the original callbacks, field names/values,
permission gates, drafts, focus/drag behavior and persistence, then compare after
migration. Add behavior tests for new interaction risks, not source-shape snapshots.
Check representative consumers and the shared browser fixture at 390/768/1024/1440,
both themes, neutral and saturated accents, keyboard and reduced motion. Include
pending/failure/retry, empty, long translation and disabled cases.

**UI drift ratchet.** `pnpm check:ui-drift` (`scripts/checks/check-ui-drift.mjs`) runs regex
rules over `src/app/**` and `src/features/**`, plus the feature sections of `src/styles/index.css`
and `bycoda.css`. The rules cover:

- undefined or Arc-only CSS variables;
- literal type, radius, size, layer and motion values;
- icon size and stroke drift, and direct `lucide-react` imports;
- loaders without reduced-motion handling;
- base-hue colour utilities;
- `themePalette.hex…`/`rgb…`/`hsl…`/`oklch…` literals in feature and app code (`theme-palette-literal`);
- native `title=` on actions;
- hand-written `role="alert"` on `p`/`span` (`role-alert-text`) or `div`/`small`/`li`/`section` (`role-alert-container`), `aria-live` on DOM elements, and `role=` passed to `<Alert>`;
- feature `createPortal` and `Popover role=menu`;
- `hover:bg-*` recipes, opacity used as the disabled state, and fixed control heights;
- raw `<button>`, `<input>`, `<select>`, `<textarea>`, `<a href>` and `target="_blank"` in
  feature code, native date/time inputs, and `Loader*` glyphs used as spinners;
- weights other than 400 and 500, arbitrary spacing values, literal layout numbers in `style={{}}`, and
  removed focus outlines;
- English prose left outside `t()` in JSX text or label/placeholder/tooltip props.

Native dialogs (`alert`, `confirm`, `prompt`), `dangerouslySetInnerHTML`, direct motion-library
imports, `console.log` in UI files and the `jsx-a11y` keyboard/ARIA rules are enforced by
the `lint` block of `vite.config.ts` through `pnpm check:invariants`. The complete convention table with
the sanctioned component for each rule is in [code invariants](code-invariants.md).

Existing findings are counted per file and rule in `scripts/checks/ui-drift-baseline.json`. A new
finding (a count above the baseline) fails `check:staged` and the bounded `check:changed` runner;
lower counts pass and are reported as improvements.

- After a migration, run `node scripts/checks/check-ui-drift.mjs --ratchet`. It lowers buckets only
  and never accepts someone else's new drift.
- `--update-baseline` rewrites every count, including increases. Use it only for an owner-approved exception or a new or widened
  rule, and record the rise in `scripts/checks/baseline-approvals.json`
  (`pnpm check:baselines` rejects it otherwise).
- `--report` prints totals per rule and folder; `--files <paths>` checks only those files.

Wiring: `scripts/checks/check-staged.mjs` runs the ratchet over the staged text of `src/**`
`.ts`/`.tsx`/`.css` files (the working tree supplies variable definitions), and
`scripts/checks/check-local.mjs` (`pnpm check:changed`) runs it over changed `src` files with
`--files`. The `web` CI job runs `pnpm run check:invariants` after the package boundary check,
and `check:web` includes it. The whole-tree `check:ui-drift` gate runs in the CI repository-hygiene job and in
`pnpm check:preflight`. The check reads
`node_modules/tailwindcss/theme.css`, so dependencies must be installed when it runs in CI.

Use `node scripts/checks/inventory-ui.mjs` (or `--json`) to measure remaining source
sites. It is an advisory inventory, not a conformance gate. Review native semantics
and dynamic/CSS candidates manually. `check-theme-colors.mjs` still owns existing
literal-color checks. `node scripts/checks/check-ui-boundaries.mjs` compares
owner-reviewed source/style fingerprint decisions; it is separate from ordinary
build/test execution and is not wired into staged checks or CI (its findings have not been triaged, and the check currently fails). Its baseline records historical component decisions with counted
signal exceptions and explicit semantic owners; its existence or a source count does not
authorize a blind baseline refresh. Heuristics do not prove behavior or complete CSS ownership:
local immutable/conditional/template class recipes and static ARIA/feedback selectors are
tracked. Indirect styles, dynamic roles, imported class recipes and specialized native
controllers still need manual review. Preserve counted exceptions with concrete
owners/reasons; line relocation alone must not invalidate a decision or bless a new bypass.

Completion means standard controls use shared adapters, remaining native internals
have named semantic owners, no feature owns a parallel control style/theme/overlay,
the free catalog has explicit coverage decisions, and Appearance uses the same
tokens and components as the workbench. Source, browser fixture, installed Windows,
installed macOS and release acceptance remain separate evidence.

## Official references

- [Apple design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
- [Apple buttons and activity feedback](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [Apple loading guidance](https://developer.apple.com/design/human-interface-guidelines/loading)
- [Arc AI tools and MCP](https://uiarc.dev/docs/ai)
- [Arc component catalog](https://uiarc.dev/r/catalog.json)
- [Arc theming](https://uiarc.dev/docs/theming)
- [Arc agent skill](https://uiarc.dev/r/skills/arc/SKILL.md)

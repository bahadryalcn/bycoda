# bycoda UI design system

This is the shared design policy for the desktop workbench. Arc supplies component
source and interaction guidance; bycoda owns the application API, compact density,
theme, accessibility, native-window integration and state contracts. Use the free
Arc catalog. Pro source and subscriptions are outside this adoption scope.

See [Arc integration](arc-ui.md) for the **implemented** adapters and local changes,
and [component selection](ui-component-catalog.md) for the coverage map. Policies
below apply to new and migrated code. Sections marked **target API** are a migration
specification, not a claim that the props or components already exist.

## Design direction

The workbench is compact, neutral and quiet. Hierarchy comes from alignment,
spacing, type and contrast. Color identifies an action's meaning or an actual state.
Each surface has one purpose, a clear heading and at most one primary action per
active task context. Avoid repeated explanations, decorative cards, oversized
headers, eyebrow labels and competing toolbars.

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

| User task                                           | Preferred interaction                 | Selection reason                                                                           |
| --------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Two to five short modes of the same data            | SegmentedControl                      | Visible alternatives and selected state; not three unrelated action buttons                |
| Peer content panels                                 | Tabs                                  | Named panels with tab navigation, focus and selection semantics                            |
| A few exclusive form choices                        | RadioGroup                            | Compare choices before submitting; use RadioCards when descriptions or consequences matter |
| One frequent action with close alternatives         | SplitButton                           | Keep the default action direct and make its variants discoverable                          |
| Several frequently used independent actions         | ButtonGroup or explicit action row    | Keep genuinely separate commands accessible; hierarchy reflects importance                 |
| Infrequent contextual commands                      | DropdownMenu or ContextMenu           | Group secondary commands without turning them into mutually exclusive values               |
| Immediate on/off preference                         | Switch                                | The new value takes effect now; form choices use Checkbox                                  |
| Short, stable single-choice list                    | Select                                | Compact selection when scanning is easy and typing provides little benefit                 |
| Long, growing or name-searchable single-choice list | Combobox / autocomplete               | Type to find a project, model, account, time zone or other named value                     |
| Several values from a long list                     | Searchable MultiSelect                | Search, selected-value summary, removal and reset without a crowded checkbox wall          |
| A few frequently toggled filters                    | ChipGroup or visible Checkbox choices | Options remain visible when comparison and repeated toggling are useful                    |

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

| Task                                                                         | Shared interaction direction                                                                        |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Find a setting, project, document or other destination from a compact header | ExpandingSearch with grouped results, existing ranking and domain navigation callbacks              |
| Filter the records currently visible                                         | SearchField/SearchInput, composed with collection filters as needed                                 |
| Set an existing form/property value                                          | SearchableSelect/Combobox or MorphSelect according to list size, local/remote data and presentation |
| Enter a value that may be absent from suggestions                            | Shared autocomplete with an explicit free-entry contract; do not substitute a closed-list picker    |
| Run commands or jump across application areas                                | CommandPalette, preserving the command registry, shortcuts, permissions and navigation owner        |

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

## Action contract

`Button.tsx` is the only ordinary action presentation owner. `SecondaryButton` and
copy, split, async and confirmation action compositions must delegate to it.
Do not add visual-only IconButton, ToolbarButton or feature-specific action skins.

This contract applies after identifying a control as an action. Radio, segmented,
tab, tree and menu composites retain their own selection/navigation semantics and
shared token presentation; their internal native buttons do not force a redesign
into a row of action Buttons.

### Implemented API: hierarchy and tone

Hierarchy and semantic color are independent:

| Property                 | Values                                                                                                       | Meaning                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `variant`                | `primary`, `secondary`, `ghost`, `link`                                                                      | Solid emphasis, outlined action, quiet action, text action                          |
| `tone`                   | `neutral`, `accent`, `info`, `success`, `warning`, `danger`                                                  | Intent, independent of hierarchy                                                    |
| Compatibility            | `variant="danger"`; `tone="error"`                                                                           | Normalize to secondary/danger and danger respectively; one style implementation     |
| Structural compatibility | `item`, `tab`                                                                                                | Existing stable direct-child rendering; interaction owner retains ARIA/roving focus |
| `size`                   | `sm`, `md`, `lg`                                                                                             | Shared token dimensions, never a local height/padding override                      |
| Other existing props     | `shape`, `iconOnly`, `label`, `tooltip`, `selected`, `loading`, `loadingLabel`, icons, `fullWidth`, `motion` | Preserve current contracts                                                          |

The shared Button implements the independent tone prop. Existing seven variants
remain compatible; legacy aliases normalize at the public adapter boundary.
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

## Fields and choices

| Need                                    | Rule                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Text or multiline value                 | `TextField` / `TextareaField`; visible label, description/error relationship and forwarded native ref |
| Search                                  | `SearchInput`/`SearchableSelect`; keep query on close; preserve clear, IME and keyboard behavior      |
| Immediate boolean preference            | Shared Switch; settings Toggle delegates and keeps sounds/persistence                                 |
| Form membership or multi-selection      | Checkbox; use mixed state for partial collection selection                                            |
| A few visible exclusive choices         | RadioGroup; RadioCards only when descriptions materially help                                         |
| Short stable exclusive list             | Select when scanning is easy; Combobox for long or searchable lists                                   |
| Several selected options                | MultiSelect, with discoverable removal and reset                                                      |
| Same data in a different view           | SegmentedControl; Tabs for peer panels of an object                                                   |
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

`NativeSearchableSelect` composes searchable presentation around a real native
single select. Keep name/form/FormData, required/defaultValue or controlled value,
native change/ref, reset, disabled option metadata and external label relationships.
Validation focuses the visible trigger and exposes the browser message, including
custom validity; imperative native focus routes there too. Do not replace it with
hidden-input-only serialization. Six initial growing form choices use this bridge;
that pilot count does not establish all consumer acceptance.

Native menu/tree controllers may use public `MenuRow`, `ContextMenu` and
`TreeRow` rather than duplicate presentation or direct registry imports. MenuRow
forwards the native row contract; ContextMenu preserves extracted ExplorerMenu
point/anchor/submenu/native-popup behavior. TreeRow owns row geometry while
FileTree keeps selection, virtualization, rename and native drop authority.

`SplitButton.menuDisabled` can independently allow menu choices when only the
primary action is disabled (Commit/Amend). Loading and group aria-disabled gate
both. Its default still derives the menu gate from primary disabled. Menu method
selection never implies execution or bypasses a confirmation.

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

Both themes and custom accents require readable text and visible controls. Target
4.5:1 normal text, 3:1 large text and 3:1 essential control boundaries/indicators
against adjacent colors. Test composited values on real backgrounds, including
glass. Hue/saturation/lightness and contrast preferences must not make meaning or
focus disappear. Status includes a label/icon, never color alone. External brand
marks, content imagery, syntax and diff data use their existing distinct shared
contracts, not UI status colors.

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
the Button's `1em` sizing; do not add a size class there. Note: `icons.tsx` `wrap()` still
defaults to `size=24, strokeWidth=2` and relies on CSS overrides.

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

## Contextual groups and morph interactions

Expanding/floating groups and morph controls are valid workbench choices when they
clarify actions or state. Evaluate them deliberately alongside ordinary controls;
do not reject a useful interaction merely because it animates. Their visual and
behavioral contracts still belong in shared UI and the existing theme/overlay system.

| Pattern              | Intended use                                                                              | Workbench integration                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FloatingButtonGroup  | A named contextual toolbar for text/object selection or a canvas                          | Adopt first inside the existing transcript selection Popover; terminal selection already composes that feature. The group does not own positioning or a new overlay.                               |
| ExpandingButtonGroup | A compact row of several familiar commands whose labels expand on pointer/keyboard intent | Evaluate Notes editor Copy/Add to chat/Link actions and transcript turn actions. This is not an overflow menu or a selector. Keep frequent/default actions discoverable.                           |
| MorphSelect          | One known scalar property, including a bounded grouped/searchable local list              | Extend the existing adapter when icons/meta/groups/search help. Do not replace custom-entry autocomplete, huge remote collections, multi-selection or several independent settings with one value. |
| ConfirmMorph         | A concise in-place confirmation/result flow already appropriate to the operation          | Reuse the existing adapter and domain save/delete queue. Preserve current confirmation/approval semantics and actual retry/undo capability.                                                        |
| IconMorph            | An existing control's icon changes with a real state                                      | A decorative glyph inside the shared action, for example Copy to check. It must not add another button, accessible name or side effect.                                                            |
| TextMorph            | A few short, infrequently changing state words                                            | Reuse existing Button label motion first; apply independently only where it adds information without double animation or duplicate announcements.                                                  |

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
an approximation from scratch. IconMorph itself is an SVG renderer, not a control.

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
continues to apply as remaining consumer and acceptance work is reconciled:

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

Use `node scripts/checks/inventory-ui.mjs` (or `--json`) to measure remaining source
sites. It is an advisory inventory, not a conformance gate. Review native semantics
and dynamic/CSS candidates manually. `check-theme-colors.mjs` still owns existing
literal-color checks. Run `node scripts/checks/check-ui-boundaries.mjs` for
owner-reviewed source/style fingerprint decisions. The baseline records 944
historical component decisions plus current additions, with counted signal
exceptions and explicit semantic owners. It remains in the uncommitted owner
review diff; its existence or a source count does
not authorize a blind baseline refresh. The command is separate from ordinary
build/test execution. Heuristics do not prove behavior or complete CSS ownership:
local immutable/conditional/template class recipes and static ARIA/feedback
selectors are tracked. Indirect styles, dynamic roles, imported class recipes and
specialized native controllers still need manual review. Preserve counted
exceptions with concrete owners/reasons;
line relocation alone must not invalidate a decision or bless a new bypass.

Completion means standard controls use shared adapters, remaining native internals
have named semantic owners, no feature owns a parallel control style/theme/overlay,
the free catalog has explicit coverage decisions, and Appearance uses the same
tokens and components as the workbench. Source, browser fixture, installed Windows,
installed macOS and release acceptance remain separate evidence.

## Official references

- [Arc AI tools and MCP](https://uiarc.dev/docs/ai)
- [Arc component catalog](https://uiarc.dev/r/catalog.json)
- [Arc theming](https://uiarc.dev/docs/theming)
- [Arc agent skill](https://uiarc.dev/r/skills/arc/SKILL.md)

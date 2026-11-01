# Shared UI component selection

Read [product design language](DESIGN.md), [design ownership](ui-design-system.md) and the
[current Arc integration](arc-ui.md) first. Application imports come from shared
bycoda adapters, never directly from the Arc registry. The official free catalog
is the selection source; consult each item's current `whenToUse`, `whenNotToUse`,
accessibility, responsive and performance metadata before implementation.

This coverage map covers desktop-relevant free components and blocks from the
catalog inspected on 2026-10-16. The upstream catalog can change. Licensed items are
excluded. A planned adapter is not installed or available merely because it has
a name here. Installation and screen migration are separate steps.

## Selection process

Start from the task rather than the current markup. Before reusing a Button,
Select or other familiar control, compare the relevant Arc alternatives using
their `whenToUse` and `whenNotToUse` guidance. Evaluate the whole interaction cluster,
not each old element independently. Three old buttons can represent three commands,
one mode, form choices or an action with variants; each calls for a different
component. The shared Button contract centralizes actual actions, not all choices.

For selection fields, document the realistic option count and growth, label length,
single/multiple values, whether typing helps, and whether custom values are allowed.
Short stable lists can use Select; long/growing/name-searchable lists use Combobox
or autocomplete, and long multi-value lists use searchable MultiSelect. Few visible
choices may be clearer as RadioGroup/RadioCards or ChipGroup. A numerical threshold
is a starting heuristic, not permission to ignore the task or remount a focused field.

Record the selected component, the alternatives considered, the reason and the
behavior that must remain. An existing shared adapter should be extended when it
lacks a reusable capability needed by the chosen interaction. Do not settle for
an ill-fitting interaction just because its adapter is already installed. The
full decision matrix and search guidance are in [design ownership](ui-design-system.md).

Review all documented exported capabilities, not only the registry item's main
name. A component may include reusable keyboard hints, a quick-look composition,
controlled selection, committed-change callbacks or alternate motion treatments.
An Installed/Reuse decision does not mean the existing adapter exposes all of them.
Compare its API before marking a capability covered. Distinguish metadata/API
review, implementation integration and behavior/browser verification.

ExpandingSearch specifically combines an expanding launcher, query input and
grouped navigation results. It is not equivalent to merely widening SearchInput.
Value selection, free-entry suggestions, in-place filtering and application commands
retain their respective contracts even when their visual treatments are similar.

Status meanings:

- **Integrated:** official registry source and a bycoda-facing integration exist;
  screen coverage may still be incomplete.
- **Installed:** official source exists, but its application-facing ownership needs work.
- **Reuse:** an existing shared adapter/composition or explicitly named native
  domain owner meets the task. Ordinary control appearance still belongs to shared
  UI. This does not claim the matching official registry source is installed or
  every optional upstream capability is covered.
- **Adopt:** suitable for the workbench; add a shared adapter before migrating consumers.
- **Conditional:** a legitimate specialized need is required before adding it.
- **Exclude:** no matching desktop purpose, or conflicts with the quiet workbench direction.

## Actions

All action composites use the one Button presentation contract, including native
fallbacks. A different animation or icon size does not justify another button API.

| Arc ID                   | Decision / owner                             | Use and boundary                                                                                                                                                                                                       |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `button`                 | Integrated: Button                           | Default single action; hierarchy and semantic tone stay centralized.                                                                                                                                                   |
| `action-button`          | Reuse: Button + caller async state           | Button loading/loadingLabel prevents duplicate activation; callers own promise, pending/result/error and permission gates. No separate ActionButton registry integration claimed.                                      |
| `split-button`           | Integrated: SplitButton composition          | Button + DropdownMenu compose explicit alternatives. Optional menuDisabled leaves Amend reachable while primary Commit is disabled; loading/group aria-disabled gate both. Method selection never implicitly executes. |
| `button-group`           | Integrated: ButtonGroup                     | Joined neutral action surface with shared hover/press; ordinary Button children keep separate hit targets, focus, tooltips and busy/disabled behavior. Used by the update/GitHub footer and installed-update notice. SplitButton, FloatingButtonGroup and ExpandingButtonGroup retain their concrete semantics; choices retain selection owners. |
| `floating-button-group`  | Integrated: shared contextual toolbar        | Transcript/terminal selection actions use the existing Popover. Preserve selection, async failures and toolbar keyboard semantics; the group is not a positioning/overlay owner.                                       |
| `expanding-button-group` | Integrated: shared compact action group      | Session Notes editor Copy/Add/Link uses the shared group. Labels expand on pointer/keyboard intent with in-place result feedback; this is not an overflow menu. Preserve touch and actual async outcome behavior.      |
| `dropdown-menu`          | Integrated: DropdownMenu over Popover        | Commands from an explicit trigger; preserve keyboard navigation and overlay routing.                                                                                                                                   |
| `context-menu`           | Reuse: ContextMenu / MenuRow                 | Public ContextMenu extracts ExplorerMenu point/anchor/submenu/native popup behavior; public MenuRow adapts existing Arc row presentation for domain controllers. Not a second menu stack.                              |
| `copy-button`            | Reuse: Button + existing clipboard callbacks | Native clipboard and feature result/error state remain authoritative; ExpandingButtonGroup supports guarded copy outcomes. No separate CopyButton source installed.                                                    |
| `theme-switch`           | Reuse: existing theme preference             | Light/dark/system selection must keep persistence and system mode.                                                                                                                                                     |
| `theme-switch-eclipse`   | Conditional: shared theme alternative        | More dramatic theme reveal. Reconsider only as a deliberate global treatment with system mode and reduced motion preserved; calm Rise is the workbench starting candidate.                                             |
| `theme-switch-split`     | Conditional: shared theme alternative        | Centered reveal variant of the same theme control, not a separate per-screen system. Select one appropriate shared treatment and preserve existing appearance state.                                                   |
| `theme-switch-rise`      | Conditional: shared calm theme treatment     | Documented for product chrome. Evaluate as one shared transition through existing light/dark/system preference and native appearance owner; do not add a second theme engine.                                          |
| `hold-to-confirm`        | Reuse: ConfirmMorph hold mode                | Existing ConfirmMorph press/hold/countdown modes preserve real async failure/retry/undo and cancellation. Hold is deliberate, not a replacement for native owner approval or exact destructive confirmation.           |
| `swipe-actions`          | Conditional: touch list composite            | Secondary touch actions need a visible keyboard/menu alternative.                                                                                                                                                      |
| `reactions`              | Conditional: shared reaction group           | Only where the product actually stores reactions; never invent feedback data.                                                                                                                                          |
| `user-menu`              | Conditional: account/profile menu need       | No generic UserMenu adapter installed. Existing provider/auth commands retain their account-specific ownership; compose DropdownMenu/ContextMenu only for a concrete account-menu workflow.                            |
| `icon-morph`             | Reuse: shared composite glyph transitions    | ConfirmMorph, MorphSelect and Alert own actual state glyph choreography with reduced motion. No generic IconMorph adapter or reason to animate static icons.                                                           |
| `confirm-morph`          | Integrated: ConfirmMorph                     | Concise in-place confirmation with the existing queue and recovery. Preserve approval/confirmation scope; Undo requires actual restoration. Review internal actions against the shared Button contract.                |

## Fields and selection

| Arc ID              | Decision / owner                                        | Use and boundary                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `input`             | Integrated: TextField                                   | Single-line entry with native props/ref, label and validation.                                                                                                                                                                                                                                         |
| `textarea` | Integrated: TextareaField | Multiline plain text. `minRows`/`maxRows` bound the height in lines, `autosize` grows with content between them (no resize handle), `fieldSize="sm"` is the tighter box, `monospace` the code face, `hideLabel` keeps the accessible name. Borderless prompt/editor surfaces use PromptField, not TextareaField. Preserve domain drafts. |
| `prompt-field` | Integrated: PromptField | Borderless, autosizing prompt/editor inside one bordered focus group (`data-ui-focus-group` frame, `data-ui-focus="group"` editor). Slots: `header`, `overlay` (highlight mirror), `children` (anchored popovers), `toolbarLeading`/`toolbarTrailing`. `quiet` (`data-ui-focus-quiet`) for the composer look; `framed={false}` when the owner already is the frame. All textarea events/ref pass through. |
| `select`            | Integrated: shared Select + settings facade             | Shared scalar choice for small lists; NativeSelect retains native form validation; growing lookups use SearchableSelect.                                                                                                                                                                               |
| `combobox` | Integrated: SearchableSelect | Search a long option list; preserve IME, clear and active option behavior. Options take `icon`, `meta` and `group`; `renderTrigger` swaps the trigger while keeping its wiring; `footer` adds actions under the list. The search row is `PopoverSearchHeader`. |
| `checkbox`          | Integrated: Checkbox                                    | Form choices and multi-selection, including mixed collection state.                                                                                                                                                                                                                                    |
| `switch`            | Integrated: shared Switch + settings facade             | Immediate boolean changes; settings facade retains sounds and metadata.                                                                                                                                                                                                                                |
| `multi-select`      | Reuse/extend: SearchableSelect multiple                 | Existing API already supports multiple values. Extend missing descriptions/disabled options and evaluate free Arc source inside this owner; do not add a duplicate generic selector.                                                                                                                   |
| `number-field`      | Reuse: NumberField over native TextField                | Native numeric ref/events/name/defaultValue/required/min/max/step/reset and invalid drafts remain; UsageBudgets parses only at save. Upstream number scrub/formatting is deliberately not implemented.                                                                                                 |
| `password-field`    | Integrated: PasswordField                               | Secret entry with accessible reveal; no logging or persistent preview of credentials.                                                                                                                                                                                                                  |
| `search-field`      | Reuse: SearchInput / SearchInputGroup                   | appearance=field owns standalone/composite surface, geometry, disabled/invalid and focus. Native refs/events/clear/reset remain; bare editor/menu composition keeps an explicit focus owner.                                                                                                           |
| `tag-input`         | Integrated: TagInput                                    | Editable token lists with keyboard removal and validation.                                                                                                                                                                                                                                             |
| `file-dropzone`     | Conditional: no current lifecycle fit                   | Unimplemented. Social immediate single-file upload and Management JSON import use native TextField type=file. Official queue/progress/retry/abort API does not preserve native name/ref/required/FileList/FormData/reset; do not invent callbacks or upload authority.                                 |
| `radio-group`       | Integrated: RadioGroup                                  | A few visible exclusive form options; not navigation between panels.                                                                                                                                                                                                                                   |
| `segmented-control` | Integrated: shared SegmentedControl | Visible exclusive choices retain radio/keyboard contracts; settings facade retains search IDs. Exclusive filter or display modes over one content area stay here (radio semantics); switching between views or panels is `Tabs`. |
| `calendar`          | Reuse: DateTimePicker / DateRangePicker                 | DateTimePicker owns native calendar-grid keyboard/local-day selection; DateRangePicker owns date-range mechanics. No separately installed Calendar adapter or date-only API claim.                                                                                                                     |
| `date-picker` | Integrated: DateTimeField / DateTimePicker `mode="date"` | Value `YYYY-MM-DD`, same as the native input; picking a day commits and closes. Replaces `TextField type="date"`. |
| `time-picker` | Integrated: DateTimeField / DateTimePicker `mode="time"` | Value `HH:mm` (24-hour local text entry, validated on blur). Replaces `TextField type="time"`. `mode="datetime"` (default) replaces `type="datetime-local"`. Native `required` blocking is not reproduced: owners validate and pass `error`. |
| `slider`            | Integrated: shared Slider + settings facade             | Approximate bounded adjustment; precise values retain a labeled numeric alternative.                                                                                                                                                                                                                   |
| `elastic-slider`    | Integrated: opt-in ElasticSlider                        | Approximate drag-to-taste values such as an Appearance preview; clamped truthful values and reduced motion required. Dense or precise settings use Slider/NumberField.                                                                                                                                 |
| `inline-edit`       | Integrated: InlineEdit                                  | Independently saved value with pending/error recovery, not one field in a grouped save.                                                                                                                                                                                                                |
| `expanding-search`  | Integrated: shared ExpandingSearch                      | Settings quick jump preserves external ranked results, controlled query and the existing overlay/focus owner. Sessions sidebar header uses `inline`: the field filters the session list (no result panel, Escape clears and folds, a dot marks the folded icon while a query applies, `ref.expand()` opens it from `/` or Ctrl+F). Other filtering and form selection retain their separate controls.                                                                                                                             |
| `chip-group`        | Reuse: SegmentedControl / RadioGroup / SearchableSelect | Stable single choices use shared radio/segmented composition; multiple growing values use SearchableSelect multiple. No separate chip control or independent selection API.                                                                                                                            |
| `password-strength` | Conditional: account creation                           | Show only when setting a new password, never for API tokens or provider credentials.                                                                                                                                                                                                                   |
| `signature-pad`     | Exclude                                                 | No current signing workflow; do not introduce canvas and export behavior without a requirement.                                                                                                                                                                                                        |
| `date-range-picker` | Integrated: DateRangePicker                             | Inclusive local-day calendar. DateTimeRangePicker composes this owner with start/end time fields for validated, end-exclusive timestamp ranges.                                                                                                                                                        |
| `color-picker`      | Reuse: ColorPickerPopover / ColorSwatchRow              | Appearance/accent and allowed content color; centralize input and contrast semantics.                                                                                                                                                                                                                  |
| `morph-select` | Integrated: MorphSelect; extend selectively | One known scalar property in a settings/detail row with a short, stable option set (groups, icons, opt-in local search); the trigger morphs into the list. Stops there: form choices with label/help/validation, long/remote/async lists, multiple values, option meta and footer actions use SearchableSelect; toolbar/composer pickers with custom triggers, rich rows, action rows, caller-owned search or embedded lists use the picker kit; commands use DropdownMenu. Independent settings retain independent values; native trigger refs/events are preserved. |
| `picker` | Integrated: picker kit (`src/shared/ui/picker/`) | `PickerPopover` (anchor, open, label, header/footer slots, dialog-aware layer, focus return) + `PopoverSearchHeader` + `PickerList` (rows: icon, title, meta, description, trailing, check placement trailing/leading/icon/none, group headings, disabled reason, action rows; single/multiple; arrows/Home/End/Enter/Space, typeahead when the list owns focus) + `PickerFooter`. `usePickerList` connects a search header to the list (`searchProps`). Not for commands (DropdownMenu) or submenu/toggle menus. |
| `money-input`       | Conditional: real currency entry                        | Currency and locale parsing must be domain-defined; usage counters are not editable money inputs.                                                                                                                                                                                                      |
| `shortcut-recorder` | Integrated: ShortcutRecorder; one shared formatter | Recorder preserves physical-key/IME validation. The one shortcut model and formatter live in `src/shared/ui/shortcut.ts` (`formatShortcutLabel`, `parseShortcutLabel`, `formatShortcut`, `shortcutTokens`, `usePlatform`); the recorder re-exports them. It reads canonical bindings (`mod+shift+k`) and display labels (`Ctrl+Shift+K`, `⌘⇧K`, `Esc Esc` sequences, `A / B` alternatives, `Ctrl/Cmd+F`) in the platform's spelling. `shared/ui/ShortcutKbd.tsx` exports ShortcutKbd and ShortcutKeys (sizes `xs` for tooltips and inline hints, `sm`, `md`); Button/Tooltip `shortcut`, DropdownMenu shortcut slots and ShortcutKeys all use it. Do not hand-format "(Ctrl+S)" into labels or tooltips. |
| `mention-input`     | Reuse: existing composer mention owner                  | ComposerTextarea/FileMentionPicker retain token model, native caret, IME and provider/file insertion; shared Button/fields own ordinary presentation. Not a generic form mention-input adapter.                                                                                                        |
| `rich-text-editor`  | Conditional: shared prose editor                        | Rich prose editing; code editors, terminals and agent composer semantics retain their owners.                                                                                                                                                                                                          |
| `billing-toggle`    | Exclude                                                 | No monthly/annual purchase choice in the desktop workbench.                                                                                                                                                                                                                                            |
| `radio-cards`       | Reuse: RadioGroup descriptions                          | Shared RadioGroup supports descriptive native radio choices with name/default/required/ref/reset; no separate card selection state or registry radio-cards integration.                                                                                                                                |
| `radio-tiles` | Feature-owned: `RadioTiles` (`src/features/settings/ui/RadioTiles.tsx`) | One exclusive choice shown as visual tiles (Appearance mode, onboarding mode and crew). A `role="radiogroup"` of item Buttons with `role="radio"`, a roving tab stop, and arrows/Home/End that select. The selected tile gets the accent border (`--ui-border-accent`), never the focus-ring colour. Use it instead of native radio inputs hidden under a card; plain descriptive choices stay RadioGroup. |

### Control-choice boundaries

- Selection owners, smallest first: Select (short stable list) -> MorphSelect (one inline property
  in a settings/detail row) -> SearchableSelect (form choice, long/async list, multiple values,
  option meta, footer actions) -> picker kit (toolbar/composer pickers with custom triggers, rich
  rows, action rows, caller-owned search). Commands are DropdownMenu, not a picker.
- Tabs switch between views of one context and own roving focus and panel ids. SegmentedControl
  chooses one exclusive filter or display mode over the same content. Native draggable workspace
  strips keep their own controller. A hand-made tablist, or a SegmentedControl that swaps panels,
  is drift.
- Prompt and editor surfaces (task description, automation instructions, quick composer, skill
  prompt) use PromptField; the main composer keeps its own implementation and follows the same
  focus contract.

### Field frame and action slots (V3)

- App-facing `Combobox` (`src/shared/ui/Combobox.tsx`) supports opt-in `allowCustomValue`.
  It filters suggestions while typing and offers a localized Use option for unmatched values.
  Enter selects the active suggestion or commits the draft; blur/Tab commits the typed value;
  Escape restores the committed value. Empty input is accepted; domain validation remains with
  the consumer. `hideLabel` retains the accessible label. Editable mode uses the existing
  Popover/overlay routing; closed-value consumers and SearchableSelect retain their defaults.

- `TextField` accepts `appearance="default" | "quiet"`, `fieldSize="sm" | "md"`, and
  `startAdornment` / `endAdornment`. `fieldVariant` still controls label/message composition.
  `TextareaField` supports the same appearance and adornments, retaining native multiline resizing.
- `SearchInput` / `SearchInputGroup` expose `appearance="quiet"` for navigation search;
  `field` is the normal filled frame and `bare` delegates its frame/focus to its composite owner.
- Shared `--ui-field-height-sm|md` roles give approximately 28/32px at compact density;
  comfortable and touch preferences scale them. Textarea height follows its multiline content.
- Frames use a faint 1px boundary and an 8px radius. Focus turns the border to `--ui-field-border-focus`
  (adjusted accent ink) and adds the 2px accent `--ui-focus-ring`; invalid fields keep the error boundary
  with `--ui-focus-ring-invalid`; forced colors keep a real outline. No field uses an inset outline.
  Composites mark the frame `data-ui-focus-group` and the inner editor `data-ui-focus="group"`;
  `data-ui-focus-quiet` on a group opts a writing surface (the chat composer) out of the ring.
- `FieldControl` owns one frame and intrinsic leading/trailing action columns. Use `InlineAction`
  inside slots for clear/reveal/step/generate actions; do not absolutely overlay buttons or guess
  padding from action counts. Slot buttons keep their hover fill inset and keyboard focus visible.
- Select menus align at the start below the trigger, at least trigger width (viewport bounds win).
  Choice rows use text and a rounded soft selected highlight. Existing menu keyboard/native routing
  stays with its controller. Searchable choices keep their search header and multiple-value semantics.
- `TextField` has `monospace` and `numeric` (tabular digits and a numeric keyboard, no steppers; use
  NumberField for min/max/step). `hideLabel` on TextField/TextareaField keeps `label` as the accessible
  name for editor-like fields.
- `PopoverSearchHeader` (`src/shared/ui/PopoverSearchHeader.tsx`) is the one search row at the top of a
  popover/picker: unframed search text (the popover is the focus context), bottom hairline, autofocus,
  `listId`/`activeOptionId` combobox wiring, `onMove` (ArrowDown/Up, optional Home/End), `onSubmit`
  (Enter, shift-aware), `onEscape`, `trailing` slot. SearchableSelect and the picker kit use it; never
  hand-roll a `border-b` search row with `SearchInput`.
- Async `Button` labels retain their widest measured width when `loading` is supplied; opt in with
  `stableWidth` for other changing labels. `Badge minWidth` reserves a caller-chosen state slot.
  These are source contracts; V3 runtime and visual acceptance is deferred to the coordinating agent.

## Disclosure and overlays

| Arc ID             | Decision / owner                                     | Use and boundary                                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drawer`           | Integrated: `Sheet` (`src/shared/ui/Sheet.tsx`)       | `side` end/bottom. Modal (default) runs on Modal's owner: `LAYER.dialog`, `aria-modal`, focus trap, Escape, backdrop, native popup routing. `modal={false}` is a side panel that keeps the page usable (`role="dialog"`, no trap): `anchor="viewport"` joins the overlay stack (Escape closes the topmost surface, child menus are its children, outside press closes unless `ignore`), `anchor="container"` fills the pane and scopes Escape to it. PanelHeader header (`headerActions`, `headerBelow`, or a custom `header` such as a tab strip), floating glass (`popover-backdrop`), `size`, optional `resizable` (shared Sash), `open={false}` keeps it mounted inert. Modal `placement="end"` remains the underlying modal owner. |
| `accordion`        | Reuse: native details / shared structural Button     | Native disclosure or existing controlled expansion keeps draft mounting and domain state; shared actions own ordinary presentation. No independent Accordion registry API installed.                                 |
| `dialog`           | Reuse: Modal                                         | An interrupting decision or bounded task; `footer` keeps actions visible below scrolling content, `<ModalActions start={…}>` gives the one action row (leading secondary/destructive at the start edge, Cancel ghost then primary at the end; `inline` for the end of a form body), `footerStart` does the same through props. `size` sm/md/lg/xl/full, `toolbar` (controls beside the title), `expandable` (Full screen / Restore), `initialFocus` (selector), `fieldEscape="field"` (Escape in a text field stays with the field). Arc presentation must join the existing modal owner. |
| `modal-actions` | Reuse: `ModalActions` (`src/shared/ui/Modal.tsx`) | The one dialog action row: `start` slot for a leading secondary/destructive action at the start edge, Cancel (ghost) then the primary action at the end; `inline` for the end of a form body. Replaces per-dialog `flex justify-end gap-2` rows. Confirmation dialogs use ConfirmDialog instead. |
| `info-popover` | Reuse: `InfoPopover` (`src/shared/ui/InfoPopover.tsx`) | The one icon-only information control for optional help: Button (`iconOnly`, accessible name and tooltip, default "Help") opening a Popover (`width`, `className` for the trigger). Never holds required state, errors or approvals. Do not add feature-local copies. |
| `confirm-dialog` | Reuse: `ConfirmDialog` / `useConfirm` (`src/shared/ui/ConfirmDialog.tsx`) | Modal confirmation: title, message, `context`, `details` (target path), `consequences` (one line each: icon + `danger` lost / `warning` at risk / `neutral` kept; `ConfirmConsequences` for hand-built dialogs), `body` (owner-controlled extra content), `requireText` (type-to-confirm, Enter confirms), `acknowledge` (checkbox or switch; `required` gates the confirm, otherwise its value reaches `onConfirm` and `confirmWith`), `confirmDisabled`, `extraActions`, `confirmLabel` (string or a function of the acknowledge state), `pendingLabel`, `danger`/`tone` (default danger). One destructive look: the final confirm is filled danger (`variant="primary" tone="danger"`) and the dialog opens on Cancel (type-to-confirm opens in its field). Optional async `onConfirm` keeps the dialog open while pending (both buttons blocked, Escape ignored) and on failure (error shown, retry live). `confirm()` resolves true only on success; `confirmWith()` resolves `{ acknowledged }` or null. Render the returned `dialog` once. |
| `popover`          | Reuse: Popover                                       | Anchored secondary controls; retain placement, Escape and native popup routing.                                                                                                                                      |
| `popover-dialog`   | Reuse: `Popover kind="dialog"`                       | A non-modal anchored dialog (filter panel, small form, details card): `role="dialog"`, focus to the first control on open (or the surface), focus back to the trigger on close, outside press and Escape through `onDismiss`. Name it with `aria-labelledby` or `aria-label`. Replaces a hand-set `role="dialog"` on Popover. Menus are not a Popover kind: use DropdownMenu or ContextMenu. |
| `tooltip`          | Integrated: shared Tooltip (`src/shared/ui/Tooltip.tsx`) | One hint for the app: a passive Popover (`role="tooltip"`), 450 ms pointer delay, 250 ms warm handoff between neighbours, immediate on keyboard focus, closed by leave/press/blur/Escape, never on touch. Title line, optional `shortcut` key caps and muted `details` lines; any `side`/`align`; `delay` option. Button routes `tooltip`, `title`, its icon-only `label` and `shortcut` through it (no native `title` attribute is rendered; `title=""` means "no tooltip"). Wrap other controls with `<Tooltip>`, or spread `useTooltip().trigger` when the control must stay a direct child. Disabled controls still open on hover; give a Button `disabledReason` so keyboard users reach the reason too. Onboarding UsageGuideTooltip keeps walkthrough placement/lifecycle. No other tooltip stack; never put essential information only in a hover hint. |
| `tabs`             | Integrated: `Tabs` / `TabList` / `Tab` / `TabPanel` / `TabStrip` (`src/shared/ui/Tabs.tsx`) | Switch between views of one context. Controlled `value`/`onValueChange`; roving focus (arrows by orientation, RTL aware, Home/End, disabled skipped, one tab stop), `activation` automatic/manual, `orientation`, `variant` tab (strip, default) / item (vertical navigation, default when vertical), `size` sm/md from the density tokens, `fill`, `responsive` (labels fold to the icon, counts to a dot; `data-tab-part` hooks for feature-specific container steps), optional `icon` and `count` (Badge count). Ids and `aria-controls` come from `<Tabs panels="each\|shared\|none">` or per-tab `controls`. The look is Button `variant="tab"`/`"item"`: no local tab styling, underline or edge stripe. Selection side effects belong in `onValueChange`. Native draggable workspace/editor tab strips (SurfaceTabs, PaneTree, terminal dock) keep their own controller; exclusive filter modes keep SegmentedControl. |
| `expandable-card`  | Integrated: ExpandableCard                           | Expand meaningful detail while preserving mounted content and focus return.                                                                                                                                          |
| `breadcrumb`       | Conditional: generic breadcrumb API not implemented  | Path/title/CwdPicker owners preserve native path and navigation behavior. Extract a shared hierarchical navigation API only for a concrete unmet workflow.                                                           |
| `bottom-sheet` | Conditional: touch/narrow task surface | Use only where a narrow task benefits; must share overlay ownership. Implemented by `Sheet side="bottom"` (see `drawer`); use only where a narrow task benefits. |
| `hover-card`       | Integrated: HoverCard (`src/shared/ui/HoverCard.tsx`) | Optional rich, interactive preview built on Popover and the Tooltip hover-intent timers: opens after 300 ms rest (warm handoff 250 ms) or at once on keyboard focus, the pointer can cross into the card (150 ms close grace), focus inside keeps it open, Escape closes and returns focus, outside press closes; content mounts only while open. `HoverCard` wraps one trigger; `useHoverCard` spreads `trigger` on a row that must stay a direct child. Everything in it needs a focus/tap route too; never hide required actions inside hover. Replace local hover timers with it. |
| `resizable-panels` | Integrated: `Sash` (`src/shared/ui/Sash.tsx`) inside the existing split owners | One resize-handle look and behaviour: pane hairline at rest, 2px interaction line on hover/drag/focus, ±3px hit area. Pointer capture, rAF-throttled `onResize(delta px since start)`, Escape/blur/lost-capture cancel (`onResizeEnd(delta, { cancelled, moved, keyboard })`), arrow keys (`step`/`largeStep`), double-click/Enter `onReset`, `role="separator"` with `aria-orientation` and optional `aria-value*`. Callers keep stored sizes, clamping and persistence. `appearance="hidden"` where the adjacent pane already draws the border. |
| `scroll-area`      | Reuse: existing native scroll containers             | Do not replace native scroll behavior or virtualized editor/terminal owners mechanically.                                                                                                                            |
| `expandable-text`  | Reuse: existing native disclosure owners             | Native details and controlled shared Button disclosure keep full supporting content, selection and mounted drafts. No separate ExpandableText adapter installed.                                                     |

## Data and content

| Arc ID                | Decision / owner                                      | Use and boundary                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `avatar`              | Reuse: domain identity renderers                      | InboxProviderMark and GitGraphParts.GraphAvatar render actual provider/author identity and fallback; controls around them remain shared. No generic Avatar registry integration claimed.                                              |
| `identity` | Integrated: `src/shared/ui/identity/` | `HarnessIcon` lives in shared (old path re-exports). `HarnessIcon`, `ProjectLogoIcon` and `ProjectMascot` take `size="xs\|sm\|md\|lg"` → `icon-xs/sm/md/lg` (+`shrink-0`); `className` then only adds. ProjectLogoIcon and ProjectMascot stay in `features/projects` because they read project logo/mascot models and the decorative-motion setting. No local size wrappers. |
| `avatar-group`        | Conditional: participant overflow API not implemented | Add only for real grouped participant identity with required overflow access; existing crew/project glyph rows do not establish this API.                                                                                             |
| `badge` | Integrated: Badge | Concise labeled status or metadata; semantic tone shared with Alert/Button. Implemented: `variant` label (default) / `dot` (status dot, text or `label`) / `count` (`max` caps as `99+`), `appearance` outline / subtle (borderless tone-subtle), control radius (pill only for the dot mark). Do not hand-roll `rounded-full` pills. `size="xs"` is the inline metadata size for triggers, rows and tab labels. `count` caps at `max` (default 99, `BADGE_COUNT_MAX`) and keeps the real number as its accessible name. Run/job/check states use `StatusBadge status="failed\|running\|retrying\|done\|queued\|warning"`: fixed tone, icon and label (running uses Spinner); `statusBadgeTone()` for dots. Do not map these states to tones locally. |
| `card`                | Integrated: `Surface` (static) / ExpandableCard / structural actions | `Surface` is the one static container: `--ui-radius-card`, `variant` plain (`--ui-surface`) / raised (`--ui-surface-raised` + pane-border frame) / outline (`--ui-pane-border`) / inset (`--ui-surface-muted`, `--ui-surface-inset` once defined), `padding` none/sm/md/lg, `as`. A nested Surface drops its frame (no card in a card). ExpandableCard owns controlled details; Button item layout=stacked owns selectable records. |
| `metric-card`         | Reuse: UsageOverview Totals/Stat + SlotText           | Usage totals retain precise formatted values/units and optional details; SlotText provides reduced-motion-aware value transitions. No second generic MetricCard model.                                                                |
| `empty-state`         | Integrated: EmptyState                                | Explain absence with one useful next step; distinguish filtered and unavailable states (`kind`, `onReset`, `onRetry`). `size="inline"` is the compact start-aligned caption row for an empty list, picker or settings group ("No matching servers." + a link-style Reset/Retry/action), with no glyph unless `icon` is passed and no motion; it replaces bare `<p>No …</p>`. The block form keeps `context` page/panel/list. |
| `tree-view`           | Reuse: TreeRow + FileTree native controller           | Public TreeRow owns native row token/density presentation. FileTree retains lazy cache, virtualization, selection, rename/ref and native coordinate drag/drop. Full registry tree controller was not substituted.                     |
| `pagination`          | Conditional: generic pagination API not implemented   | Keep existing bounded/windowed collection controllers, counts and shared next/show-more actions. Add generic Pagination only for a concrete unmet page-selection workflow.                                                            |
| `sortable-data-table` | Integrated: SortableDataTable                         | Comparable records and real numeric sorting; bound long data and preserve grouping.                                                                                                                                                   |
| `sparkline`           | Reuse: DiagnosticsPanel ResourceChart                 | Actual sampled trend/empty state and accessible diagnostics content stay domain-owned, with shared semantic tokens and controls. No generic sparkline registry adapter installed.                                                     |
| `gauge`               | Integrated: `Meter` (`src/shared/ui/Meter.tsx`) | Informational bounded measure (`role="meter"`): `variant` linear/ring, `value` (`null` = unknown, no meter role), `min`/`max`, `warning`/`danger` thresholds that switch to the status tones, base `tone`, `size` sm/md, `label`/`valueText`, ring centre content. `meterTone()` lets callers colour matching text. Task progress stays Progress; quotas with remaining/over-limit copy stay UsageMeter. |
| `animated-counter`    | Conditional: reduced-motion-aware Metric detail       | A changing KPI needs stable width; never animate every token increment in a live log.                                                                                                                                                 |
| `code-block`          | Reuse: current markdown/code presentation             | Integrate shared toolbar/appearance; preserve highlighting, selection and copy behavior.                                                                                                                                              |
| `image-compare`       | Integrated: ImageCompare / ImageLightbox              | Explicit local-image comparison with URL cleanup and existing zoom/pan.                                                                                                                                                               |
| `carousel`            | Conditional: shared media navigation                  | Sequential media only; keep task data and forms directly accessible.                                                                                                                                                                  |
| `card-stack`          | Conditional: one-by-one triage mode                   | Real review queues with explicit decide/undo outcomes; preserve list access, async completion and approval policy. Use a list/table for comparison and Carousel for browsing without decisions.                                       |
| `bar-chart`           | Integrated: Charts.tsx BarChart                       | Category/time-bucket comparisons with localized units and a table alternative. Usage owns filtering and aggregation.                                                                                                                  |
| `activity-heatmap`    | Integrated: Charts.tsx ActivityHeatmap                | Measured daily activity over long ranges, localized value formatter, legend, keyboard navigation and day selection. Short usage ranges use a responsive day/hour grid.                                                                |
| `timeline`            | Integrated: Timeline                                  | Chronological task/history events with localized headings and visible recovery actions.                                                                                                                                               |
| `line-chart`          | Integrated: Charts.tsx LineChart                      | Bounded time-series trends with configured series colors, localized units and a table alternative. Diagnostics ResourceChart remains domain-owned.                                                                                    |
| `donut-chart`         | Integrated: Charts.tsx DonutChart                     | Nonnegative part-to-whole totals with configured category colors, exact values and explicit filter selection.                                                                                                                         |
| `streamgraph`         | Conditional: composed time series                     | Only with a real analytical need and readable zero/series semantics.                                                                                                                                                                  |
| `brush-chart`         | Conditional: time-range exploration                   | Long time series needs range selection; use the existing range state owner.                                                                                                                                                           |
| `ridgeline`           | Conditional: distribution comparison                  | Multiple measured distributions; ordinary usage totals use simpler charts.                                                                                                                                                            |
| `treemap`             | Conditional: hierarchical allocation                  | Real hierarchy and meaningful area; provide exact values separately.                                                                                                                                                                  |
| `waffle-chart`        | Conditional: coarse proportions                       | Small discrete totals; exact quotas remain accessible through UsageMeter/table.                                                                                                                                                       |
| `slope-chart`         | Conditional: two-period comparison                    | Compare rank/value changes between two points; not a generic time series.                                                                                                                                                             |
| `json-viewer`         | Integrated: JsonViewer                                | Complete structured payload; preserve plain text/diff/truncated-output paths.                                                                                                                                                         |
| `chat-thread`         | Reuse: existing session transcript                    | Extract shared message presentation where useful; preserve streaming, tools, virtualization and approvals.                                                                                                                            |
| `comment-thread`      | Conditional: real threaded comments                   | Only with stored thread/reply data; preserve drafts and permissions.                                                                                                                                                                  |

## Layout and structure

| Shared part | Owner | Use and boundary |
| ----------- | ----- | ---------------- |
| Pane header       | `PaneHeader` (`src/shared/ui/PaneHeader.tsx`) | Compact pane/tool header that doubles as a title bar: height `calc(var(--ui-control-height-compact) + 0.5rem)` (override `--ui-pane-header-height`), `--ui-pane-border` hairline (`bordered`), secondary-size medium title in content ink. Slots: `leading` (back/navigation), `icon`, `title` (`titleAs`, `titleId`), `meta`, `children` (middle: tabs, search), `actions`, `trailing` (window controls). `chromeInset` reserves the macOS traffic-light space; `dragRegion` sets `data-tauri-drag-region` (`true` = `"deep"`) and marks the control slots `"false"`. Dialogs, sheets and popovers keep `PanelHeader`. |
| Window chrome inset | `WindowChromeInset` (`src/shared/ui/PaneHeader.tsx`) | The macOS traffic-light spacer (78px, `--ui-window-chrome-inset`; `size="compact"` 16px). Renders nothing off macOS; `active` for conditions such as `!besideRail`. Replaces every `IS_MAC ? <div className="w-[78px] shrink-0" /> : null`. |
| Section label     | `SectionLabel` (`src/shared/ui/SectionLabel.tsx`) | Group/section label: caption size, medium weight, `--ui-text-secondary`, sentence case, never uppercase or tracked. Optional `count` (+ `countLabel`), trailing `actions` slot (always visible), `collapsible` disclosure (`expanded`, `onExpandedChange`, `controls`; heading wraps the button). |
| Divider           | `Divider` (`src/shared/ui/Divider.tsx`) | Hairline in `--ui-pane-border`: horizontal/vertical, `inset` sm/md, optional `label` (centre or start), `decorative`. Use instead of local `border-t` spacer divs and nested card frames. |

Compose these instead of local header rows, eyebrow labels, card recipes, `w-[78px]` spacers, resize-handle recipes, hand-made meter bars and roving-key tab handlers. `Surface`, `Sash`, `Meter` and `Tabs` are in the Data, Disclosure and Tabs rows of the tables above.

## Feedback

| Arc ID             | Decision / owner                              | Use and boundary                                                                    |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `alert`            | Integrated: Alert / inline notice             | Visible operation/error/warning context with recovery and shared semantic tones. Implemented: `inline` one-line form without card chrome for in-row errors/warnings.    |
| `inline-error`     | Integrated: `InlineError` / `InlineMessage` (`src/shared/ui/InlineError.tsx`) | One-line field, row or form message: tone ink (`--ui-tone-*-fg`), `text-ui-caption`, the tone glyph (same per tone as Alert). InlineError: danger, `role="alert"` (`live="polite"\|"off"` for an error already present on open), optional `retry={{ onRetry, pending }}` as a link-style Retry after the copy, or `action`. InlineMessage adds warning/info/success/neutral (polite). Never a bare `<p role="alert">`; boxed notices with a title stay Alert; a region that failed to load stays FailureState. |
| `toast`            | Integrated: `ToastRegion` / `Toast` / `ToastSlot` / `useToast` (`src/shared/ui/ToastRegion.tsx`); TransientNotice | Background/nonblocking events; foreground save feedback stays in its control/row. One fixed column per corner (`bottom-end` default, `top-end`, `bottom-start`, `top-start`) at `LAYER.toast`; toasts stack by layout, so there is no height reporting or offset arithmetic. `<Toast>` is a component-owned card (tone neutral/info/success/warning/danger, `title`, `message`, `children`, `action`, `actions`, `progress`, `onDismiss`, `dismissDisabled`, `durationMs` with `null` = sticky; danger defaults sticky), on the floating glass with the attention tones tinted; expiry pauses on hover, focus and a hidden window. `<ToastSlot placement order>` puts a feature's own card (reminder panel, approval request) in the same stack; menus opened inside it open above the stack. `useToast()`/`toast` (`show`/`update`/`dismiss`/`dismissAll`) feeds the imperative queue rendered by `<ToastRegion insets>`, mounted once per window. TransientNotice renders the same card and joins the stack unless it still passes the deprecated `offset`/`onHeightChange`. |
| `progress`         | Integrated: Progress                          | Measurable operation progress; indeterminate is distinct from a fabricated percent. |
| `skeleton`         | Integrated: Skeleton                          | Loading occupies final geometry; do not hide a recoverable failure indefinitely.    |
| `spinner`          | Integrated: `Spinner` / `LoadingText`                | Spinner is the one pending glyph: `size` xs/sm/md = `icon-xs/sm/md`, `inline` follows the text size inside a label, `currentColor`, pulse instead of rotation under reduced motion, `label` for an accessible name when nothing else announces progress. `LoadingText` is the one "Loading…" line (Spinner + muted caption, `role="status"`, `layout="inline"` or `"fill"` for Suspense fallbacks, `delay` hides it for 150ms so warm work never flashes). Lucide `Loader`/`LoaderCircle` with `animate-spin` are deprecated. |
| `toast-stack` | Integrated: ToastRegion / ToastSlot | One stack per corner, one dismissal and accessibility policy; no second toast layer. Feature cards (reminders, approvals) join through `ToastSlot`; never position a notice with `fixed` and an offset. |
| `usage-meter`      | Integrated: UsageMeter                        | Used/remaining quota, reset time and account color semantics.                       |
| `stepper`          | Integrated: Stepper                           | A real ordered onboarding/configuration workflow with validation and recovery.      |
| `countdown`        | Conditional: real known deadline/reset        | Preserve authoritative time; avoid decorative urgency.                              |
| `cookie-consent`   | Exclude                                       | No matching desktop cookie-consent requirement.                                     |
| `announcement-bar` | Reuse: shared notification/status composition | Real app-wide notice with visible recovery; avoid another decorative banner.        |

## Text effects

| Arc ID          | Decision / owner                      | Use and boundary                                                                                                                                                    |
| --------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text-reveal`   | Exclude                               | Decorative reveal delays workbench content.                                                                                                                         |
| `in-view-title` | Exclude                               | Scroll-driven title entrances are unnecessary in product panels.                                                                                                    |
| `text-morph`    | Conditional: shared short-state label | Use existing Button label motion first. Independent short state words may morph with existing aria-live ownership; no wrapping, streamed prose or double animation. |
| `text-shimmer`  | Reuse: Shimmer, narrowly scoped       | Existing progress/working affordance only; do not shimmer static product copy.                                                                                      |
| `slot-text`     | Integrated: SlotText for Usage KPI    | A few dashboard/KPI values changing with period selection; compare AnimatedCounter/MetricCard. Avoid streaming values and long text.                                |

## Free blocks

Blocks are reference compositions, not a new application shell. Adapt their useful
structure through shared bycoda components and real data. Do not install marketing
blocks into the desktop just to increase catalog coverage.

| Arc ID                | Decision                                                | Reason / owning composition                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command-palette`     | Conditional: global command composition not implemented | Settings ExpandingSearch owns ranked settings quick-jump; composer command/mention controllers retain their registries and permissions. Neither is blanket global CommandPalette coverage; add only for a concrete cross-app command workflow.                               |
| `notification-center` | Reuse existing notifications                            | Keep persistence, grouping, unread state, approvals and recovery in their owners.                                                                                                                                                                                            |
| `file-upload`         | Conditional: no current upload-row lifecycle fit        | Unimplemented official block. Social single-file callbacks do not expose queue/removal/retry/cancel contracts; JSON import and editor insertion/drop retain their native owners. A future concrete upload lifecycle needs a real native input bridge and existing callbacks. |
| `otp-input`           | Conditional                                             | Only a real verification flow with resend/paste/expiry behavior.                                                                                                                                                                                                             |
| `changelog-feed`      | Conditional                                             | Release history view when required; do not replace updater state or permissions.                                                                                                                                                                                             |
| `sign-in`             | Reuse existing provider/onboarding flow                 | Apply shared fields/actions; preserve current OAuth/native flows.                                                                                                                                                                                                            |
| `page-header`         | Reuse: existing compact panel compositions              | Shared Button/DropdownMenu/Popover compose real panel heading, frequent action and overflow; domain title/permission state stays local. No separate page-header block installed.                                                                                             |
| `empty-states`        | Reuse: EmptyState / Alert / Progress                    | Shared adapters distinguish empty/filtered/error/loading feedback with feature-owned recovery callbacks; no duplicate block-level lifecycle.                                                                                                                                 |
| `signup-form`         | Exclude                                                 | No new app account-registration workflow.                                                                                                                                                                                                                                    |
| `logo-marquee`        | Exclude                                                 | Marketing decoration.                                                                                                                                                                                                                                                        |
| `plan-comparison`     | Exclude                                                 | No subscription purchase flow in this workbench task.                                                                                                                                                                                                                        |
| `login-centered`      | Exclude                                                 | Duplicates the existing embedded/native onboarding shell.                                                                                                                                                                                                                    |
| `site-header`         | Exclude                                                 | Marketing site navigation is not desktop window navigation.                                                                                                                                                                                                                  |
| `site-footer`         | Exclude                                                 | No public-site footer in the application.                                                                                                                                                                                                                                    |
| `hero-section`        | Exclude                                                 | Oversized promotional surface conflicts with compact workbench tasks.                                                                                                                                                                                                        |
| `faq-section`         | Conditional: genuine help questions                     | May inform guide/help FAQs when actual question-and-answer content exists. Compose shared Accordion/search and compact app spacing; do not import marketing framing or fabricate a new support flow.                                                                         |
| `contact-section`     | Exclude                                                 | No contact-form requirement.                                                                                                                                                                                                                                                 |
| `blog-grid`           | Exclude                                                 | No editorial article index requirement.                                                                                                                                                                                                                                      |
| `comparison-table`    | Conditional                                             | A real comparison requirement; prefer existing SortableDataTable for records.                                                                                                                                                                                                |
| `stats-band`          | Exclude                                                 | Promotional KPI strip; use compact shared metrics for actual measurements.                                                                                                                                                                                                   |
| `cta-section`         | Exclude                                                 | Marketing conversion structure does not belong in workbench panels.                                                                                                                                                                                                          |
| `newsletter-signup`   | Exclude                                                 | No mailing-list subscription requirement.                                                                                                                                                                                                                                    |

## Implemented families and explicit gaps

The mandatory field/feedback foundation now includes TextField, TextareaField,
Select/NativeSelect, SearchableSelect/NativeSearchableSelect, Checkbox, Switch,
Slider, SegmentedControl, NumberField, PasswordField, RadioGroup, TagInput, Badge,
Alert, EmptyState, Progress and Skeleton. Each uses its actual public adapter
contract; this is source availability, not uniform native-form semantics.
NumberField intentionally preserves native numeric drafts rather than implementing
upstream scrubbing/formatting; TagInput names only its draft input, not serialized
committed tags. PasswordField has no credential-strength policy.

NativeSearchableSelect covers the six initial growing Social native form choices
with real select required/defaultValue/ref/name/FormData/reset/change/validation
focus behavior. MenuRow, ContextMenu and TreeRow extract reusable native
presentation without taking editor/tree/menu interaction authority. SplitButton
keeps primary/menu gates distinct. SearchInput/Group field appearance and the
compact/comfortable/touch preference are implemented; no separate density key.

FileDropzone/FileUpload are deliberately unimplemented following actual Social
media and Management JSON lifecycle comparison. Their official upload rows own
progress/retry/removal/AbortSignal and lack the native form bridge required here.
Existing immediate single-file TextField callbacks are task-fit; editor image
drops are insertion/save/recovery owners. A concrete per-file retry/cancel or
requested drop workflow is the dependency, not a requirement to invent one.

Other genuinely absent generic capabilities remain Conditional in their rows:
breadcrumb, pagination, participant overflow, activity heatmap and global
command palette. The former drawer gap is closed by `Sheet`. Existing native/domain compositions are not proof that those
generic APIs or all upstream variants were delivered. Conditional/excluded rows
retain their use-case decisions across all 112 components and 22 blocks.

`node scripts/checks/check-ui-boundaries.mjs` consumes owner-reviewed fingerprint
decisions, not a raw-native-tag ban. Baseline reconciliation/acceptance is root
work. Variable/assembled classes, CSS indirection and native event/permission
contracts require manual review. `check-ui-drift.mjs` is the per-file count ratchet
for token, typography, icon, layer, motion, tooltip, error and overlay drift (see
`ui-design-system.md`, "UI drift ratchet"). It runs on every staged `src` file.
`check-ui-boundaries.mjs` is not wired into staged checks or CI yet: it still
reports about 263 unreviewed findings. Record source checks, offline browser
fixture acceptance and installed app/platform acceptance separately; no catalog
status substitutes for those results.

## Installation and acceptance

Use `pnpm exec shadcn add @uiarc/<id>` only after reviewing official metadata,
registry dependencies, existing source and local adaptations. The project already
has its registry alias, pinned CLI and Motion dependency. Do not install everything
in one command or overwrite adapted files. Installed controls are not automatically
approved public APIs and are not evidence that existing screens have migrated.

Each adopted control needs a shared adapter, theme/token bridge, native ref/event
and overlay integration, i18n, documented states, a representative consumer and
meaningful focused/browser checks. Choose one representative first, then migrate
the rest in ordered feature waves. Keep the current implementation list in
`arc-ui.md` accurate when an adapter becomes available.

Official metadata and use-case guidance: [Arc catalog](https://uiarc.dev/r/catalog.json),
[AI/MCP setup](https://uiarc.dev/docs/ai), [readable index](https://uiarc.dev/llms.txt).

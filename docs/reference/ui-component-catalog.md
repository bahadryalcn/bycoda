# Shared UI component selection

Read [design ownership](ui-design-system.md) and the
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
| `button-group`           | Reuse: shared action compositions            | SplitButton, FloatingButtonGroup and ExpandingButtonGroup own their concrete group semantics; ordinary static rows compose Button. Radio/segmented choices retain selection owners.                                    |
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
| `textarea`          | Integrated: TextareaField                               | Multiline plain text; preserve autosize and domain drafts.                                                                                                                                                                                                                                             |
| `select`            | Integrated: shared Select + settings facade             | Shared scalar choice for small lists; NativeSelect retains native form validation; growing lookups use SearchableSelect.                                                                                                                                                                               |
| `combobox`          | Integrated: SearchableSelect                            | Search a long option list; preserve IME, clear and active option behavior.                                                                                                                                                                                                                             |
| `checkbox`          | Integrated: Checkbox                                    | Form choices and multi-selection, including mixed collection state.                                                                                                                                                                                                                                    |
| `switch`            | Integrated: shared Switch + settings facade             | Immediate boolean changes; settings facade retains sounds and metadata.                                                                                                                                                                                                                                |
| `multi-select`      | Reuse/extend: SearchableSelect multiple                 | Existing API already supports multiple values. Extend missing descriptions/disabled options and evaluate free Arc source inside this owner; do not add a duplicate generic selector.                                                                                                                   |
| `number-field`      | Reuse: NumberField over native TextField                | Native numeric ref/events/name/defaultValue/required/min/max/step/reset and invalid drafts remain; UsageBudgets parses only at save. Upstream number scrub/formatting is deliberately not implemented.                                                                                                 |
| `password-field`    | Integrated: PasswordField                               | Secret entry with accessible reveal; no logging or persistent preview of credentials.                                                                                                                                                                                                                  |
| `search-field`      | Reuse: SearchInput / SearchInputGroup                   | appearance=field owns standalone/composite surface, geometry, disabled/invalid and focus. Native refs/events/clear/reset remain; bare editor/menu composition keeps an explicit focus owner.                                                                                                           |
| `tag-input`         | Integrated: TagInput                                    | Editable token lists with keyboard removal and validation.                                                                                                                                                                                                                                             |
| `file-dropzone`     | Conditional: no current lifecycle fit                   | Unimplemented. Social immediate single-file upload and Management JSON import use native TextField type=file. Official queue/progress/retry/abort API does not preserve native name/ref/required/FileList/FormData/reset; do not invent callbacks or upload authority.                                 |
| `radio-group`       | Integrated: RadioGroup                                  | A few visible exclusive form options; not navigation between panels.                                                                                                                                                                                                                                   |
| `segmented-control` | Integrated: shared SegmentedControl                     | Visible exclusive choices retain radio/keyboard contracts; settings facade retains search IDs.                                                                                                                                                                                                         |
| `calendar`          | Reuse: DateTimePicker / DateRangePicker                 | DateTimePicker owns native calendar-grid keyboard/local-day selection; DateRangePicker owns date-range mechanics. No separately installed Calendar adapter or date-only API claim.                                                                                                                     |
| `date-picker`       | Reuse: DateTimePicker, evaluate shared date-only API    | Date-only entry must preserve local-day boundaries and locale.                                                                                                                                                                                                                                         |
| `time-picker`       | Reuse: DateTimePicker, evaluate shared time-only API    | Time entry must preserve format/timezone and scheduling semantics.                                                                                                                                                                                                                                     |
| `slider`            | Integrated: shared Slider + settings facade             | Approximate bounded adjustment; precise values retain a labeled numeric alternative.                                                                                                                                                                                                                   |
| `elastic-slider`    | Integrated: opt-in ElasticSlider                        | Approximate drag-to-taste values such as an Appearance preview; clamped truthful values and reduced motion required. Dense or precise settings use Slider/NumberField.                                                                                                                                 |
| `inline-edit`       | Integrated: InlineEdit                                  | Independently saved value with pending/error recovery, not one field in a grouped save.                                                                                                                                                                                                                |
| `expanding-search`  | Integrated: shared ExpandingSearch                      | Settings quick jump preserves external ranked results, controlled query and the existing overlay/focus owner. Filtering and form selection retain their separate controls.                                                                                                                             |
| `chip-group`        | Reuse: SegmentedControl / RadioGroup / SearchableSelect | Stable single choices use shared radio/segmented composition; multiple growing values use SearchableSelect multiple. No separate chip control or independent selection API.                                                                                                                            |
| `password-strength` | Conditional: account creation                           | Show only when setting a new password, never for API tokens or provider credentials.                                                                                                                                                                                                                   |
| `signature-pad`     | Exclude                                                 | No current signing workflow; do not introduce canvas and export behavior without a requirement.                                                                                                                                                                                                        |
| `date-range-picker` | Integrated: DateRangePicker                             | Inclusive local-day calendar. DateTimeRangePicker composes this owner with start/end time fields for validated, end-exclusive timestamp ranges.                                                                                                                                                        |
| `color-picker`      | Reuse: ColorPickerPopover / ColorSwatchRow              | Appearance/accent and allowed content color; centralize input and contrast semantics.                                                                                                                                                                                                                  |
| `morph-select`      | Integrated: MorphSelect; extend selectively             | Known scalar properties may benefit from groups/icons/meta and local search. Groups, disabled options, native trigger refs/events and opt-in search are implemented; independent settings retain independent values. Free-entry, remote-large and multiple-value lists keep suitable selection owners. |
| `money-input`       | Conditional: real currency entry                        | Currency and locale parsing must be domain-defined; usage counters are not editable money inputs.                                                                                                                                                                                                      |
| `shortcut-recorder` | Integrated: ShortcutRecorder; extend shared display     | Recorder preserves physical-key/IME validation. Implemented: `shared/ui/ShortcutKbd.tsx` exports ShortcutKbd and ShortcutKeys (sizes `xs` for inline hints, `sm`, `md`) for hints/help. Also evaluate ShortcutList exports for reusable hints and help without duplicate per-feature key styling/listeners.                                                                                                           |
| `mention-input`     | Reuse: existing composer mention owner                  | ComposerTextarea/FileMentionPicker retain token model, native caret, IME and provider/file insertion; shared Button/fields own ordinary presentation. Not a generic form mention-input adapter.                                                                                                        |
| `rich-text-editor`  | Conditional: shared prose editor                        | Rich prose editing; code editors, terminals and agent composer semantics retain their owners.                                                                                                                                                                                                          |
| `billing-toggle`    | Exclude                                                 | No monthly/annual purchase choice in the desktop workbench.                                                                                                                                                                                                                                            |
| `radio-cards`       | Reuse: RadioGroup descriptions                          | Shared RadioGroup supports descriptive native radio choices with name/default/required/ref/reset; no separate card selection state or registry radio-cards integration.                                                                                                                                |

## Disclosure and overlays

| Arc ID             | Decision / owner                                     | Use and boundary                                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drawer`           | Integrated: Modal `placement="end"`                  | Task session previews use the shared Modal side placement, retaining its focus, Escape, portal and native popup ownership. Existing feature side panels retain their domain lifecycle.                               |
| `accordion`        | Reuse: native details / shared structural Button     | Native disclosure or existing controlled expansion keeps draft mounting and domain state; shared actions own ordinary presentation. No independent Accordion registry API installed.                                 |
| `dialog`           | Reuse: Modal                                         | An interrupting decision or bounded task; `footer` keeps actions visible below scrolling content. Arc presentation must join the existing modal owner.                                                               |
| `info-popover` | Reuse: `InfoPopover` (`src/shared/ui/InfoPopover.tsx`) | The one icon-only information control for optional help: Button (`iconOnly`, accessible name and tooltip, default "Help") opening a Popover (`width`, `className` for the trigger). Never holds required state, errors or approvals. Do not add feature-local copies. |
| `confirm-dialog` | Reuse: `ConfirmDialog` / `useConfirm` (`src/shared/ui/ConfirmDialog.tsx`) | Modal confirmation with title, message, confirm label, `danger` tone (default), optional async `onConfirm` with pending state (both buttons disabled, loading confirm, error kept visible on failure). `confirm()` resolves true only on success. Render the returned `dialog` once. |
| `popover`          | Reuse: Popover                                       | Anchored secondary controls; retain placement, Escape and native popup routing.                                                                                                                                      |
| `tooltip`          | Reuse: Button native tooltip / existing help Popover | Button translated label/title and focusable help Popover cover ordinary optional help. Onboarding UsageGuideTooltip keeps walkthrough placement/lifecycle. No new tooltip stack or essential hover-only information. |
| `tabs`             | Reuse: Button tab + existing panel controllers       | Shared structural tab presentation preserves caller role/ARIA/roving focus; native draggable workspace tabs retain their controller. No generic Tabs state API is claimed.                                           |
| `expandable-card`  | Integrated: ExpandableCard                           | Expand meaningful detail while preserving mounted content and focus return.                                                                                                                                          |
| `breadcrumb`       | Conditional: generic breadcrumb API not implemented  | Path/title/CwdPicker owners preserve native path and navigation behavior. Extract a shared hierarchical navigation API only for a concrete unmet workflow.                                                           |
| `bottom-sheet`     | Conditional: touch/narrow task surface               | Use only where a narrow task benefits; must share overlay ownership.                                                                                                                                                 |
| `hover-card`       | Conditional: preview, composed over shared overlay   | Optional rich preview with a focus/tap route; never hide required actions inside hover.                                                                                                                              |
| `resizable-panels` | Reuse: existing workspace splitters                  | Evaluate Arc inside the current split/resize owner; preserve stored sizes and native drag.                                                                                                                           |
| `scroll-area`      | Reuse: existing native scroll containers             | Do not replace native scroll behavior or virtualized editor/terminal owners mechanically.                                                                                                                            |
| `expandable-text`  | Reuse: existing native disclosure owners             | Native details and controlled shared Button disclosure keep full supporting content, selection and mounted drafts. No separate ExpandableText adapter installed.                                                     |

## Data and content

| Arc ID                | Decision / owner                                      | Use and boundary                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `avatar`              | Reuse: domain identity renderers                      | InboxProviderMark and GitGraphParts.GraphAvatar render actual provider/author identity and fallback; controls around them remain shared. No generic Avatar registry integration claimed.                                              |
| `avatar-group`        | Conditional: participant overflow API not implemented | Add only for real grouped participant identity with required overflow access; existing crew/project glyph rows do not establish this API.                                                                                             |
| `badge`               | Integrated: Badge                                     | Concise labeled status or metadata; semantic tone shared with Alert/Button. Implemented: `variant` label (default) / `dot` (status dot, text or `label`) / `count` (`max` caps as `99+`), `appearance` outline / subtle (borderless tone-subtle), control radius (pill only for the dot mark). Do not hand-roll `rounded-full` pills.                                                                                                                                                           |
| `card`                | Reuse: ExpandableCard / shared structural actions     | ExpandableCard owns controlled details with mounted inert content; Button item layout=stacked owns selectable records. Existing detail/navigation lifecycle remains feature-owned; not blanket coverage of all registry card exports. |
| `metric-card`         | Reuse: UsageOverview Totals/Stat + SlotText           | Usage totals retain precise formatted values/units and optional details; SlotText provides reduced-motion-aware value transitions. No second generic MetricCard model.                                                                |
| `empty-state`         | Integrated: EmptyState                                | Explain absence with one useful next step; distinguish filtered and unavailable states.                                                                                                                                               |
| `tree-view`           | Reuse: TreeRow + FileTree native controller           | Public TreeRow owns native row token/density presentation. FileTree retains lazy cache, virtualization, selection, rename/ref and native coordinate drag/drop. Full registry tree controller was not substituted.                     |
| `pagination`          | Conditional: generic pagination API not implemented   | Keep existing bounded/windowed collection controllers, counts and shared next/show-more actions. Add generic Pagination only for a concrete unmet page-selection workflow.                                                            |
| `sortable-data-table` | Integrated: SortableDataTable                         | Comparable records and real numeric sorting; bound long data and preserve grouping.                                                                                                                                                   |
| `sparkline`           | Reuse: DiagnosticsPanel ResourceChart                 | Actual sampled trend/empty state and accessible diagnostics content stay domain-owned, with shared semantic tokens and controls. No generic sparkline registry adapter installed.                                                     |
| `gauge`               | Conditional: actual bounded capacity                  | Known minimum/maximum; avoid decorative gauges for unbounded metrics.                                                                                                                                                                 |
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

## Feedback

| Arc ID             | Decision / owner                              | Use and boundary                                                                    |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `alert`            | Integrated: Alert / inline notice             | Visible operation/error/warning context with recovery and shared semantic tones. Implemented: `inline` one-line form without card chrome for in-row errors/warnings.    |
| `toast`            | Reuse: TransientNotice / notifications        | Background/nonblocking events; foreground save feedback stays in its control/row. Implemented: `tone`, `title`, `children`, `action`, `actions`, `progress`, `durationMs` (`null` = sticky), `placement`/`offset`, `anchor`, `onHeightChange`; new floating shells reuse it.   |
| `progress`         | Integrated: Progress                          | Measurable operation progress; indeterminate is distinct from a fabricated percent. |
| `skeleton`         | Integrated: Skeleton                          | Loading occupies final geometry; do not hide a recoverable failure indefinitely.    |
| `toast-stack`      | Reuse: current notification owner             | One queue, dismissal and accessibility policy; no second toast layer.               |
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
drawer, breadcrumb, pagination, participant overflow, activity heatmap and global
command palette. Existing native/domain compositions are not proof that those
generic APIs or all upstream variants were delivered. Conditional/excluded rows
retain their use-case decisions across all 112 components and 22 blocks.

`node scripts/checks/check-ui-boundaries.mjs` consumes owner-reviewed fingerprint
decisions, not a raw-native-tag ban. Baseline reconciliation/acceptance is root
work and the baseline is currently uncommitted. Variable/assembled classes, CSS
indirection and native event/permission contracts require manual review. Record
source checks, offline browser fixture acceptance and installed app/platform
acceptance separately; no catalog status substitutes for those results.

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

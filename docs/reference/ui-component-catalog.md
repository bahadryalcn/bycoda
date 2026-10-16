# Shared UI component selection

Read [design ownership](ui-design-system.md) and the
[current Arc integration](arc-ui.md) first. Application imports come from shared
bycoda adapters, never directly from the Arc registry. The official free catalog
is the selection source; consult each item's current `whenToUse`, `whenNotToUse`,
accessibility, responsive and performance metadata before implementation.

This coverage map accounts for all 112 free components and 22 free blocks in the
catalog inspected on 2026-10-16. Counts can change upstream. Licensed items are
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
- **Reuse:** a shared bycoda capability already owns the interaction; evaluate Arc
  visuals inside that owner rather than adding a parallel implementation.
- **Adopt:** suitable for the workbench; add a shared adapter before migrating consumers.
- **Conditional:** a legitimate specialized need is required before adding it.
- **Exclude:** no matching desktop purpose, or conflicts with the quiet workbench direction.

## Actions

All action composites use the one Button presentation contract, including native
fallbacks. A different animation or icon size does not justify another button API.

| Arc ID                   | Decision / owner                              | Use and boundary                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `button`                 | Integrated: Button                            | Default single action; hierarchy and semantic tone stay centralized.                                                                                                                                         |
| `action-button`          | Adopt: async behavior composed with Button    | A commit needs pending/result feedback in place; avoid a second toolbar button skin.                                                                                                                         |
| `split-button`           | Adopt: shared split-action composite          | A main operation has a short list of close alternatives; unrelated actions belong in a menu.                                                                                                                 |
| `button-group`           | Adopt: shared grouping                        | Related actions need one compact boundary; selection still uses segmented/radio semantics.                                                                                                                   |
| `floating-button-group`  | Adopt: shared contextual toolbar              | First candidate: transcript/terminal selection actions inside existing Popover. Preserve selection, async failures and toolbar keyboard semantics; the group is not a positioning/overlay owner.             |
| `expanding-button-group` | Adopt: shared compact action group            | First candidate: Notes editor Copy/Add/Link cluster. Labels expand on pointer/keyboard intent with in-place result feedback; this is not an overflow menu. Preserve touch and actual async outcome behavior. |
| `dropdown-menu`          | Adopt: shared menu over Popover               | Commands from an explicit trigger; preserve keyboard navigation and overlay routing.                                                                                                                         |
| `context-menu`           | Installed: shared context-menu adapter needed | Commands on a tree/item; reuse existing ExplorerMenu/native routing and scope.                                                                                                                               |
| `copy-button`            | Adopt: clipboard action over Button           | Copy with visible success/failure; keep the native clipboard bridge.                                                                                                                                         |
| `theme-switch`           | Reuse: existing theme preference              | Light/dark/system selection must keep persistence and system mode.                                                                                                                                           |
| `theme-switch-eclipse`   | Conditional: shared theme alternative         | More dramatic theme reveal. Reconsider only as a deliberate global treatment with system mode and reduced motion preserved; calm Rise is the workbench starting candidate.                                   |
| `theme-switch-split`     | Conditional: shared theme alternative         | Centered reveal variant of the same theme control, not a separate per-screen system. Select one appropriate shared treatment and preserve existing appearance state.                                         |
| `theme-switch-rise`      | Conditional: shared calm theme treatment      | Documented for product chrome. Evaluate as one shared transition through existing light/dark/system preference and native appearance owner; do not add a second theme engine.                                |
| `hold-to-confirm`        | Adopt: shared confirmation action             | Deliberate irreversible operation; retain existing approval and async failure behavior.                                                                                                                      |
| `swipe-actions`          | Conditional: touch list composite             | Secondary touch actions need a visible keyboard/menu alternative.                                                                                                                                            |
| `reactions`              | Conditional: shared reaction group            | Only where the product actually stores reactions; never invent feedback data.                                                                                                                                |
| `user-menu`              | Adopt: shared account menu composition        | Account/profile commands; use current provider/auth owners and menu routing.                                                                                                                                 |
| `icon-morph`             | Adopt: shared state glyphs                    | Copy/check and real state transitions inside shared actions. SVG glyphs only; do not add another button or animate static icons.                                                                             |
| `confirm-morph`          | Integrated: ConfirmMorph                      | Concise in-place confirmation with the existing queue and recovery. Preserve approval/confirmation scope; Undo requires actual restoration. Review internal actions against the shared Button contract.      |

## Fields and selection

| Arc ID              | Decision / owner                                     | Use and boundary                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`             | Integrated: TextField                                | Single-line entry with native props/ref, label and validation.                                                                                                                                                          |
| `textarea`          | Integrated: TextareaField                            | Multiline plain text; preserve autosize and domain drafts.                                                                                                                                                              |
| `select`            | Installed: settings Select facade                    | Move generic presentation into shared UI; small unsearchable lists, not large lookup lists.                                                                                                                             |
| `combobox`          | Integrated: SearchableSelect                         | Search a long option list; preserve IME, clear and active option behavior.                                                                                                                                              |
| `checkbox`          | Adopt: Checkbox                                      | Form choices and multi-selection, including mixed collection state.                                                                                                                                                     |
| `switch`            | Installed: settings Toggle facade                    | Immediate preference changes; extract generic shared Switch while retaining sounds/settings metadata.                                                                                                                   |
| `multi-select`      | Reuse/extend: SearchableSelect multiple              | Existing API already supports multiple values. Extend missing descriptions/disabled options and evaluate free Arc source inside this owner; do not add a duplicate generic selector.                                    |
| `number-field`      | Adopt: NumberField                                   | Bounded numeric editing; preserve empty/intermediate values and validation.                                                                                                                                             |
| `password-field`    | Adopt: PasswordField                                 | Secret entry with accessible reveal; no logging or persistent preview of credentials.                                                                                                                                   |
| `search-field`      | Reuse: SearchInput                                   | Existing focus-owner/clear/IME contract is authoritative; integrate source there if needed.                                                                                                                             |
| `tag-input`         | Adopt: TagInput                                      | Editable token lists with keyboard removal and validation.                                                                                                                                                              |
| `file-dropzone`     | Adopt: FileDropzone                                  | File selection/drop; keep Tauri paths, file policy and hidden native input inside the shared owner.                                                                                                                     |
| `radio-group`       | Adopt: RadioGroup                                    | A few visible exclusive form options; not navigation between panels.                                                                                                                                                    |
| `segmented-control` | Installed: settings Segmented facade                 | Change the view of the same data; preserve radio/keyboard contracts during extraction.                                                                                                                                  |
| `calendar`          | Adopt: shared calendar primitive                     | Date-grid selection used by pickers; no separate feature-owned calendar.                                                                                                                                                |
| `date-picker`       | Reuse: DateTimePicker, evaluate shared date-only API | Date-only entry must preserve local-day boundaries and locale.                                                                                                                                                          |
| `time-picker`       | Reuse: DateTimePicker, evaluate shared time-only API | Time entry must preserve format/timezone and scheduling semantics.                                                                                                                                                      |
| `slider`            | Installed: settings Slider facade                    | Approximate bounded adjustment; precise values retain a labeled numeric alternative.                                                                                                                                    |
| `elastic-slider`    | Conditional: single visual adjustment                | Approximate drag-to-taste values such as an Appearance preview; clamped truthful values and reduced motion required. Dense or precise settings use Slider/NumberField.                                                  |
| `inline-edit`       | Integrated: InlineEdit                               | Independently saved value with pending/error recovery, not one field in a grouped save.                                                                                                                                 |
| `expanding-search`  | Adopt: shared ExpandingSearch                        | Distinct icon-to-field navigation search with grouped results. Start with Settings quick jump; preserve external ranking/query/results and overlay/focus, rather than only widening SearchInput.                        |
| `chip-group`        | Adopt: shared choice chips                           | Compact filters/selections with labels; do not create another segmented/tab API.                                                                                                                                        |
| `password-strength` | Conditional: account creation                        | Show only when setting a new password, never for API tokens or provider credentials.                                                                                                                                    |
| `signature-pad`     | Exclude                                              | No current signing workflow; do not introduce canvas and export behavior without a requirement.                                                                                                                         |
| `date-range-picker` | Integrated: DateRangePicker                          | Inclusive local-day analytics range; preserve existing aggregation boundaries.                                                                                                                                          |
| `color-picker`      | Reuse: ColorPickerPopover / ColorSwatchRow           | Appearance/accent and allowed content color; centralize input and contrast semantics.                                                                                                                                   |
| `morph-select`      | Integrated: MorphSelect; extend selectively          | Known scalar properties may benefit from groups/icons/meta and local search. Current adapter disables search; extend it where needed. Free-entry, remote-large and multiple-value lists keep suitable selection owners. |
| `money-input`       | Conditional: real currency entry                     | Currency and locale parsing must be domain-defined; usage counters are not editable money inputs.                                                                                                                       |
| `shortcut-recorder` | Integrated: ShortcutRecorder; extend shared display  | Recorder preserves physical-key/IME validation. Also evaluate ShortcutKbd/ShortcutKeys/ShortcutList exports for reusable hints and help without duplicate per-feature key styling/listeners.                            |
| `mention-input`     | Adopt selectively: shared mention presentation       | Composer mentions; preserve current token model, editor caret and provider behavior.                                                                                                                                    |
| `rich-text-editor`  | Conditional: shared prose editor                     | Rich prose editing; code editors, terminals and agent composer semantics retain their owners.                                                                                                                           |
| `billing-toggle`    | Exclude                                              | No monthly/annual purchase choice in the desktop workbench.                                                                                                                                                             |
| `radio-cards`       | Adopt: shared descriptive RadioGroup composition     | A few options benefit from descriptions; simple preferences use compact radios.                                                                                                                                         |

## Disclosure and overlays

| Arc ID             | Decision / owner                                   | Use and boundary                                                                               |
| ------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `drawer`           | Adopt: shared side-detail surface                  | Long record/form beside context; register with existing overlay/focus owners.                  |
| `accordion`        | Adopt: shared disclosure                           | Independent expandable sections; keep hidden drafts mounted where needed.                      |
| `dialog`           | Reuse: Modal                                       | An interrupting decision or bounded task; Arc presentation must join the existing modal owner. |
| `popover`          | Reuse: Popover                                     | Anchored secondary controls; retain placement, Escape and native popup routing.                |
| `tooltip`          | Adopt: shared tooltip                              | Short optional help on hover/focus; errors and essential instructions remain visible.          |
| `tabs`             | Adopt: shared Tabs semantics/presentation          | Peer panels of one object; preserve native draggable workspace tabs separately.                |
| `expandable-card`  | Integrated: ExpandableCard                         | Expand meaningful detail while preserving mounted content and focus return.                    |
| `breadcrumb`       | Adopt: Breadcrumb                                  | Hierarchical location/path navigation; long paths must stay reachable.                         |
| `bottom-sheet`     | Conditional: touch/narrow task surface             | Use only where a narrow task benefits; must share overlay ownership.                           |
| `hover-card`       | Conditional: preview, composed over shared overlay | Optional rich preview with a focus/tap route; never hide required actions inside hover.        |
| `resizable-panels` | Reuse: existing workspace splitters                | Evaluate Arc inside the current split/resize owner; preserve stored sizes and native drag.     |
| `scroll-area`      | Reuse: existing native scroll containers           | Do not replace native scroll behavior or virtualized editor/terminal owners mechanically.      |
| `expandable-text`  | Adopt: shared text disclosure                      | Long supporting text/log explanation; complete content and selection remain available.         |

## Data and content

| Arc ID                | Decision / owner                                | Use and boundary                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `avatar`              | Adopt: Avatar                                   | User/provider identity and fallback with accessible naming.                                                                                                                                                                      |
| `avatar-group`        | Adopt: AvatarGroup                              | Compact participants with overflow access; not an icon decoration row.                                                                                                                                                           |
| `badge`               | Adopt: Badge                                    | Concise labeled status or metadata; semantic tone shared with Alert/Button.                                                                                                                                                      |
| `card`                | Adopt: shared record card / quick look          | Browsable content plus optional controlled details/open state. Evaluate useful shared quick-look behavior through existing overlay owners; do not reduce the item to a decorative surface or replace required detail navigation. |
| `metric-card`         | Adopt: Metric                                   | Usage/diagnostic scalar with comparable period and units.                                                                                                                                                                        |
| `empty-state`         | Adopt: EmptyState                               | Explain absence with one useful next step; distinguish filtered and unavailable states.                                                                                                                                          |
| `tree-view`           | Reuse/extract: shared tree-row presentation     | Files/source control hierarchy; retain virtualization, selection, rename and drag contracts.                                                                                                                                     |
| `pagination`          | Adopt: Pagination                               | Bounded long collections with accessible current page and counts.                                                                                                                                                                |
| `filter-toolbar`      | Integrated: FilterToolbar                       | Compose inside the shared filter popover; do not add a competing state owner.                                                                                                                                                    |
| `sortable-data-table` | Integrated: SortableDataTable                   | Comparable records and real numeric sorting; bound long data and preserve grouping.                                                                                                                                              |
| `sparkline`           | Adopt: shared chart adapter                     | Small historical trend with accessible summary; not a replacement for precise data.                                                                                                                                              |
| `gauge`               | Conditional: actual bounded capacity            | Known minimum/maximum; avoid decorative gauges for unbounded metrics.                                                                                                                                                            |
| `animated-counter`    | Conditional: reduced-motion-aware Metric detail | A changing KPI needs stable width; never animate every token increment in a live log.                                                                                                                                            |
| `code-block`          | Reuse: current markdown/code presentation       | Integrate shared toolbar/appearance; preserve highlighting, selection and copy behavior.                                                                                                                                         |
| `image-compare`       | Integrated: ImageCompare / ImageLightbox        | Explicit local-image comparison with URL cleanup and existing zoom/pan.                                                                                                                                                          |
| `carousel`            | Conditional: shared media navigation            | Sequential media only; keep task data and forms directly accessible.                                                                                                                                                             |
| `card-stack`          | Conditional: one-by-one triage mode             | Real review queues with explicit decide/undo outcomes; preserve list access, async completion and approval policy. Use a list/table for comparison and Carousel for browsing without decisions.                                  |
| `bar-chart`           | Adopt: shared usage/diagnostic chart            | Compare categories; consistent series tokens, units and accessible values.                                                                                                                                                       |
| `activity-heatmap`    | Adopt: shared activity chart                    | Activity over days/time; legend and text alternative required.                                                                                                                                                                   |
| `timeline`            | Integrated: Timeline                            | Chronological task/history events with localized headings and visible recovery actions.                                                                                                                                          |
| `line-chart`          | Adopt: shared time-series chart                 | Time trend; preserve sampling, range, units and accessible details.                                                                                                                                                              |
| `donut-chart`         | Conditional: actual part-to-whole data          | Few nonnegative categories with known total; use table/bar for close comparisons.                                                                                                                                                |
| `streamgraph`         | Conditional: composed time series               | Only with a real analytical need and readable zero/series semantics.                                                                                                                                                             |
| `brush-chart`         | Conditional: time-range exploration             | Long time series needs range selection; use the existing range state owner.                                                                                                                                                      |
| `ridgeline`           | Conditional: distribution comparison            | Multiple measured distributions; ordinary usage totals use simpler charts.                                                                                                                                                       |
| `treemap`             | Conditional: hierarchical allocation            | Real hierarchy and meaningful area; provide exact values separately.                                                                                                                                                             |
| `waffle-chart`        | Conditional: coarse proportions                 | Small discrete totals; exact quotas remain accessible through UsageMeter/table.                                                                                                                                                  |
| `slope-chart`         | Conditional: two-period comparison              | Compare rank/value changes between two points; not a generic time series.                                                                                                                                                        |
| `json-viewer`         | Integrated: JsonViewer                          | Complete structured payload; preserve plain text/diff/truncated-output paths.                                                                                                                                                    |
| `chat-thread`         | Reuse: existing session transcript              | Extract shared message presentation where useful; preserve streaming, tools, virtualization and approvals.                                                                                                                       |
| `comment-thread`      | Conditional: real threaded comments             | Only with stored thread/reply data; preserve drafts and permissions.                                                                                                                                                             |

## Feedback

| Arc ID             | Decision / owner                              | Use and boundary                                                                    |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `alert`            | Adopt: Alert / inline notice                  | Visible operation/error/warning context with recovery and shared semantic tones.    |
| `toast`            | Reuse: TransientNotice / notifications        | Background/nonblocking events; foreground save feedback stays in its control/row.   |
| `progress`         | Adopt: Progress                               | Measurable operation progress; indeterminate is distinct from a fabricated percent. |
| `skeleton`         | Adopt: Skeleton                               | Loading occupies final geometry; do not hide a recoverable failure indefinitely.    |
| `toast-stack`      | Reuse: current notification owner             | One queue, dismissal and accessibility policy; no second toast layer.               |
| `usage-meter`      | Integrated: UsageMeter                        | Used/remaining quota, reset time and account color semantics.                       |
| `stepper`          | Adopt: Stepper                                | A real ordered onboarding/configuration workflow with validation and recovery.      |
| `countdown`        | Conditional: real known deadline/reset        | Preserve authoritative time; avoid decorative urgency.                              |
| `cookie-consent`   | Exclude                                       | No matching desktop cookie-consent requirement.                                     |
| `announcement-bar` | Reuse: shared notification/status composition | Real app-wide notice with visible recovery; avoid another decorative banner.        |

## Text effects

| Arc ID          | Decision / owner                        | Use and boundary                                                                                                                                                    |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text-reveal`   | Exclude                                 | Decorative reveal delays workbench content.                                                                                                                         |
| `in-view-title` | Exclude                                 | Scroll-driven title entrances are unnecessary in product panels.                                                                                                    |
| `text-morph`    | Conditional: shared short-state label   | Use existing Button label motion first. Independent short state words may morph with existing aria-live ownership; no wrapping, streamed prose or double animation. |
| `text-shimmer`  | Reuse: Shimmer, narrowly scoped         | Existing progress/working affordance only; do not shimmer static product copy.                                                                                      |
| `slot-text`     | Conditional: short period-change values | A few dashboard/KPI values changing with period selection; compare AnimatedCounter/MetricCard. Avoid streaming values and long text.                                |

## Free blocks

Blocks are reference compositions, not a new application shell. Adapt their useful
structure through shared bycoda components and real data. Do not install marketing
blocks into the desktop just to increase catalog coverage.

| Arc ID                | Decision                                | Reason / owning composition                                                                                                                                                                          |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command-palette`     | Adopt: shared command composition       | Search/run existing commands and navigate app areas. Preserve command registry, shortcut binding, permissions and navigation callbacks; this is not form-value autocomplete.                         |
| `notification-center` | Reuse existing notifications            | Keep persistence, grouping, unread state, approvals and recovery in their owners.                                                                                                                    |
| `file-upload`         | Adopt through FileDropzone              | Existing attachments/Tauri file lifecycle; no new upload authority.                                                                                                                                  |
| `otp-input`           | Conditional                             | Only a real verification flow with resend/paste/expiry behavior.                                                                                                                                     |
| `changelog-feed`      | Conditional                             | Release history view when required; do not replace updater state or permissions.                                                                                                                     |
| `sign-in`             | Reuse existing provider/onboarding flow | Apply shared fields/actions; preserve current OAuth/native flows.                                                                                                                                    |
| `page-header`         | Adopt compact composition               | One common panel/settings heading with primary action and overflow.                                                                                                                                  |
| `empty-states`        | Adopt through EmptyState                | Consistent loading/empty/filtered/error distinctions across features.                                                                                                                                |
| `signup-form`         | Exclude                                 | No new app account-registration workflow.                                                                                                                                                            |
| `logo-marquee`        | Exclude                                 | Marketing decoration.                                                                                                                                                                                |
| `plan-comparison`     | Exclude                                 | No subscription purchase flow in this workbench task.                                                                                                                                                |
| `login-centered`      | Exclude                                 | Duplicates the existing embedded/native onboarding shell.                                                                                                                                            |
| `site-header`         | Exclude                                 | Marketing site navigation is not desktop window navigation.                                                                                                                                          |
| `site-footer`         | Exclude                                 | No public-site footer in the application.                                                                                                                                                            |
| `hero-section`        | Exclude                                 | Oversized promotional surface conflicts with compact workbench tasks.                                                                                                                                |
| `faq-section`         | Conditional: genuine help questions     | May inform guide/help FAQs when actual question-and-answer content exists. Compose shared Accordion/search and compact app spacing; do not import marketing framing or fabricate a new support flow. |
| `contact-section`     | Exclude                                 | No contact-form requirement.                                                                                                                                                                         |
| `blog-grid`           | Exclude                                 | No editorial article index requirement.                                                                                                                                                              |
| `comparison-table`    | Conditional                             | A real comparison requirement; prefer existing SortableDataTable for records.                                                                                                                        |
| `stats-band`          | Exclude                                 | Promotional KPI strip; use compact shared metrics for actual measurements.                                                                                                                           |
| `cta-section`         | Exclude                                 | Marketing conversion structure does not belong in workbench panels.                                                                                                                                  |
| `newsletter-signup`   | Exclude                                 | No mailing-list subscription requirement.                                                                                                                                                            |

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

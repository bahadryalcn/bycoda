---
name: feature-shared-ui
description: Shared UI redesign inventory for public bycoda controls, task-sized geometry, surfaces/states, form and choice contracts, menus/overlays, rows, feedback, content adapters and the real ControlSpecimen reference. Read before shared component redesign or claiming cross-screen consistency.
---

# Shared UI components and redesign

## Purpose and keywords

Give shared components their own design/acceptance contract, alongside screen
layouts. Keywords: Button, fields, Select, search/filter, checkbox/switch, tree
row, menu/popover/modal/sheet, feedback, component state matrix and specimen.
Reuse Arc through bycoda adapters; no second UI library or global reset.

## Surface inventory

Inspected2026-10-28, main@d8bf868fae841b8b391ce148487cd7d373ea9762, source0.6.94,
dirty shared checkout. Search roots: src/shared/ui, src/styles, docs/reference,
representative feature consumers and tests/browser/arc-controls*.69 public root
TSX modules are indexed in20 families; that is not a claim every state/leaf is
rendered or reviewed. Full explicit module list and family acceptance:
temp/local/2026-10-28-shared-components-redesign/INVENTORY.md.

- UIF01 actions: Button, SecondaryButton, SplitButton, ButtonGroup, Floating/
  ExpandingButtonGroup, ConfirmMorph.
- UIF02–08 fields/choices: TextField, TextareaField, PasswordField, InlineEdit,
  SearchInput, ExpandingSearch, Select/SearchableSelect/NativeSearchableSelect/
  MorphSelect/TagInput, Checkbox/Switch/RadioGroup/SegmentedControl, NumberField,
  Slider/ElasticSlider, DateRange/DateTime/DateTimeRange and ColorPickerPopover.
- UIF09–12 navigation/collections/overlays: TabLabel/Stepper, TreeRow, ContextMenu/
  DropdownMenu/MenuRow, Popover/Modal/InfoPopover/ConfirmDialog/NativePopupHost.
- UIF13–16 feedback/containers: Alert/Badge/TransientNotice/WorkingIndicator,
  EmptyState/FailureState/RecoveryBoundary, Progress/Skeleton/Shimmer, ExpandableCard.
- UIF17–19 data/media/text: Charts/SortableDataTable/Timeline/UsageMeter,
  ImageAnnotationCanvas/ImageCompare/ImageLightbox, JsonViewer/MatchText/SlotText/
  ParticleText/PrivateEmail/Timestamp/ShortcutKbd/ShortcutRecorder/icons.
- UIF20 reference/support: ControlSpecimen and lazySurface; fixture integration
  tests/browser/arc-controls.tsx and arc-controls.spec.ts. Existing sample is used
  by browser fixtures; do not claim a production Appearance specimen route exists.
- Owning roles: src/styles/index.css, arc.css, palette.css, bycoda.css. Public
  adapter-specific styles and Arc source stay under src/shared/ui. Thin wrapper
  imports do not prove local adapter geometry/state/API is complete.
- Overlay state: shared overlay.ts, Popover/Modal/native context menu and existing
  NativePopupHost routing; feature sheets retain domain state/permission ownership.
- Platform/native boundary: shared controls preserve native button/ref/drag/focus,
  popup/window routing and feature callbacks. This package adds no Host/RPC/tool/
  Rust operation or new permission. Feature/mobile adapters remain separate;
  desktop control appearance is not automatically routed to Expo components.
- Locales: shared t/useT, labels/help/error/empty/progress/copy and date/number/
  shortcut families; preserve locale and exact content/privacy semantics.
- Tests: shared Button/SplitButton, Select/SearchableSelect/NativeSearchableSelect/
  MorphSelect, PasswordField/NumberField/SearchInput/RadioGroup, TreeRow,
  ContextMenu/DropdownMenu/MenuRow, Popover/Modal/overlay, arcAdapters,
  loadingAdapters/RecoveryBoundary and feature consumers. Full tests/source
  evidence is recorded under temp/verification/2026-10-28-shared-components-redesign.

## Owner decisions

2026-10-28, T3 thread0567326f-aade-4baa-89f3-b44c6256ae9e, exact quote:

> genel componentler üzerine bir redesign yok sanırım ama demi? ekranların var genel componentlerimizide iyileştirmemiz gerekmezmi?

The owner requires shared components to improve as well as screens. Detailed
target choices remain proposals in REDESIGN.md until implemented/accepted; do
not infer new appearance defaults or blanket accent coloring.

## Behavior to preserve

Current APIs/ref/native forms, draft/IME/cursor/password/numeric behavior,
short/searchable/multiple/free-entry distinctions, selected/on/mixed/disabled/
readonly/pending roles, split independent gates, native/menu semantics, anchor/
focus/Escape/scroll/nesting, data/media/privacy meaning and reduced motion.
Feature controllers retain selection/fetch/authorization/retry authority. Existing
custom fonts/palettes/scale/density and shared-control work must survive.

## Checks and visual scenarios

14 CMP source/design records and20 UIF delivery families are tracked in the
common TODO. Use real ControlSpecimen/consumer state matrices, light/dark1280/800,
custom accents, narrow/short panes, keyboard, reduced motion and applicable native/
mobile boundaries. Include explicit Button alignment, row selected-versus-drop,
full diagnostic copy, disabled/async choice state and popup bounded scrolling.
Do not use static schematics or audit-time tests to close implemented redesign.

## Known blockers and evidence limits

No app implementation or redesigned captures in this audit. Four source findings
are distinguished from eight contracts, one API gap and one coverage gap. Existing
screen records EXP-02/DT-01/SEL-04/SEL-08/CMD-03 stay independently scoped. Real
contrast/native/reader/installed acceptance remains unverified; implementing owners
must supply proof. Claims API unavailable; concurrent Button/Badge work preserved.

## Delivered core-control implementation (Session 2, 2026-10-28)

Uncommitted on main over 83053d6b8 (shared checkout); no commit/build/install.

- Actions (CMP-02/03, UIF-01): explicit `align` beats tab/item defaults; 14/16px
  icon slots; string labels truncate inside bounded containers; ButtonGroup and
  SplitButton share seams, end radii, unclipped focus and independent gates.
- Choices (CMP-06, UIF-05): drawn native Checkbox (on/mixed/invalid/disabled/forced
  colors); Radio, Checkbox and Switch share `--control-on`; `Segment.disabled`.
- Fields (CMP-01/04, UIF-02/03): one frame/focus owner; error before helper in
  aria-describedby; read-only distinct from disabled; fields no longer stretch in
  grids; `SearchInputGroup size` / `SearchInput fieldSize` `sm|md`.
- Select/SearchableSelect (CMP-05, UIF-04, T3UI-03): option `disabled` with keyboard
  skip; `loading/error/onRetry/noOptionsLabel`; framed value chips. No MultiSelect and
  no windowing (no consumer above a few hundred options). CreateWorktreeDialog is
  wired to loading/error.
- Rows/tabs/text (CMP-08, UIF-09/10/19, T3UI-01): drop target is an accent edge,
  distinct from selection; TreeRow slots; TabLabel `truncate="middle"` and
  TabDirtyDot; new MiddleTruncate; MatchText weight plus accent ink and `data-match`.
- T3UI-05: no wizard (2 Stepper consumers). T3UI-08: mobile does not import src/shared/ui.
- Reference (CMP-07, UIF-20): fixture matrix tests/browser/arc-controls-matrix.tsx
  (`arc-controls.html?view=matrix`) with specs in arc-controls.spec.ts.
  Evidence, requests and open items: temp/local/2026-10-28-shared-controls-impl/
  (handoff-A..D.md, REQUESTS.md, INVENTORY-CONSUMERS.md) and
  temp/verification/2026-10-28-shared-controls-impl/. Fixture captures are not
  installed/native acceptance. Feature adoption (FileTree, tab strips, path consumers,
  async pickers) stays with owning sessions.

H1 night pass (2026-10-28, uncommitted over 4de508dea, NOT tested per owner rule):
- Button reserves no empty icon slot for icon-less `loading` text actions.
- `ActionHost` + `InlineAction` (Button `inset`) for row/tab/card actions: one host
  highlight, transparent compact action, reveal on hover/focus/selection/touch.
  Adopted by SearchInput clear, PasswordField reveal, TagInput/SearchableSelect chips
  and TreeRow; feature migrations belong to their lines.
- F3 contract: caller className sets placement only (`@layer components`).
- UIF-06/07/08/16/19 and FloatingButtonGroup, ExpandingButtonGroup, ConfirmMorph,
  InlineEdit, MorphSelect passes.
Handoff: temp/local/2026-10-28-h1-shared-controls/handoff.json (+ handoff-F1/F2.md).

## Committed handoff references

No new commit/build/install/release. Local brief:
temp/local/2026-10-28-shared-components-redesign/{AUDIT.md,REDESIGN.md,INVENTORY.md}.
Source baseline/hash and focused checks are evidence only, not installed inclusion.

## Proposals and ownership

Owner request, 2026-10-28: “tüm ui componentleri için yapalım birde eksik ihtiyacımız olan daha iyi tasarlanmış componentlerde olabilir t3code dan karşılaştıraiblirsin bunları orda olup bizde olmayan daha iyi olabilecek şeyler olabilir”. T3UI-01–08 in `temp/local/2026-10-28-t3-shared-ui-comparison/AUDIT.md` add source-backed comparison candidates and feature/mobile coverage gates. These are open evaluation and delivery records, not proof of missing controls or accepted redesign. T3 upstream snapshot is `5e9d56416f6b395095c772c597e79cd5f94e3052`; installed version identity relative to that snapshot is unknown. Preserve the ownership below; extend existing primitives and overlay routing when a concrete need is confirmed.

Session1 owns semantic roles/metrics. Session2 owns core/reference and data/text
families, Session5 overlay/menu/feedback/media families. ControlSpecimen and its
shared browser fixture have a single writer, Session2; Session5 supplies scenarios
through its own files/handoff. Sessions3/4/6 consume, not restyle shared primitives.
UIF01–15/20 are immediate priority; UIF16–19 remain explicit follow-up delivery
with existing capabilities preserved, not blanket rewrites or silently accepted.

## Session 5 overlay/feedback/media delivery, 2026-10-28 (uncommitted)

Owner, 2026-10-28, Session 5 overlays conversation, exact quote:

> Bu bir uygulama görevidir; yalnızca audit veya dokümantasyonla bitirme. Mevcut componentlerin görünümünü ve etkileşimlerini gerçekten iyileştir.

Delivered in the shared checkout (main, uncommitted, fixture-verified only):
UIF-11 one compact/described menu row and role-based states for DropdownMenu,
native ContextMenu, MenuRow and the Arc menu (CMP-09/14); UIF-12 raised Modal
surface, compact/task title hierarchy and pane-style end sheet (CMP-11), explicit
Popover `flow` (CMP-10), ConfirmDialog in-flight guard and Alert failure, InfoPopover
focus/Escape return; UIF-13 Alert action slot, Badge count/dot grammar, sticky
danger TransientNotice with pending action, labelled WorkingIndicator; UIF-14
EmptyState `context`, FailureState full-copy/manual fallback/pending retry
(CMP-12/13), RecoveryBoundary reset keys; UIF-15 moving unknown progress, no early
100%, reduced/decorative-off motion; UIF-18 theme-independent ImageCompare chrome
(styling-architecture F6), lightbox zoom/compare/retry and annotation fallback.
Fixtures: `tests/browser/overlay-{popups,menus,feedback,media}.*` (suite
`overlays`). Handoff, consumer inventory and open requests:
`temp/local/2026-10-28-session5-overlays/`. Open: dark raised-plane hover/pressed
role (Session 1), Button reserved spinner slot (Session 2), EmptyState `context`
and Popover `flow` adoption by consumers, real native popup windows, touch devices,
screen readers and installed inclusion.

Follow-up H2-1b (2026-10-28, uncommitted, untested by owner rule "test yapmasınlar
en iyisi kodları yazsınlar en son testi biz yaparız"): WorkingIndicator owns its
color (`--color-active`, bars no longer follow currentColor) and `size="xs|sm|md"`
on the icon scale; consumer color/width/font classes are inert. Consumer cleanup
and `TerminalSpinner` size forwarding belong to the owning lines; see
`temp/local/2026-10-28-overlays-impl/handoff.json`.

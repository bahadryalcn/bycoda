---
name: feature-theme-foundation
description: Shared desktop theme surface hierarchy, accent/focus/text-selection roles, pane boundaries, control readability and forced-colors. Read with Appearance and shared-ui before changing src/styles.
---

# Shared desktop theme foundation

## Scope and ownership

Session 1 owns the relevant `src/styles/` roles and the shared design-system
reference. Core controls/specimen belong to Session 2, menus/overlays to Session 5,
and settings/shell/Servers to Sessions 3/4/6. A card is not a lock. No live feature
claim tool was available in this session; the shared checkout contains concurrent
staged and unstaged changes that must be preserved.

Read `feature-appearance`, `feature-shared-ui`, `feature-workbench-design` and
`docs/reference/{DESIGN,ui-design-system,arc-ui,ui-component-catalog}.md`.
Source baseline: main `83053d6b830fba764f702411faca464de28b1a29`, with the prior
four focus-role replacements and design reference already present. This packet
does not authorize a build/install/release, branch change or shared TODO update.

## Surface inventory

- `src/styles/index.css`: canvas, panel, reading/form and raised surfaces; neutral
  hover/press, accent-aware selection, text/disabled, structural/control edges,
  shared focus and ordinary/overlay text-selection roles. Existing density,
  contrast, tint, native glass and motion preferences retain their owners.
- `src/styles/bycoda.css`: legacy panel/raised aliases, ProjectRail and Sidebar
  surfaces/edges, active navigation markers. Native opacity rules in index.css
  keep precedence over opaque pane styling.
- `src/styles/arc.css`: scoped adapters consume selected surface, field surface
  and control border; disabled fields avoid a second opacity fade. Forced-colors
  uses system focus/selection with disabled selections excluded.
- Theme/persistence owners remain `settings/model/appearance.ts`,
  `appearancePreferences.ts`, and `settings/ui/useAppearanceSettings.tsx`.
  No storage/model/Host/RPC/Rust/permission behavior changed.
- Real component fixtures: `tests/browser/{arc-controls,settings,servers,
  compact-navigation}.tsx`. They use synthetic memory-only data/bridges and do
  not prove a native or installed application.
- Other selection adapters remain `files/editor/editorChrome.ts`,
  `files/ui/pdfTextLayer.css`, `terminal/ui/TerminalView.tsx`; normal Composer
  Send's explicit accent tone is a separate consumer-owner dependency.
- Mobile `mobile/src/ui/theme.ts` and mobile Appearance stores are separately
  owned. Desktop CSS is not consumed by Expo.

## Owner decision

2026-10-28, current theme implementation conversation, exact quote:

> Bu teslim beklediğim tema redesign’ını karşılamıyor.

> kendi sahipliğindeki tema dosyalarında somut görsel iyileştirmeleri uygula

The request explicitly includes light/dark/custom surfaces, accent/selection,
focus/text/border/disabled/status, forced colors and real consumer evidence.

## Preservation

Keep saved colors/tint/lightness/contrast/fonts/scale/density, status/diff/running
meaning, solid accent foreground contrast pairs, native glass opacity and
platform gates, transparent editor glyphs, keyboard/selection/drag behavior,
drafts, persistence and all existing operations. No preference-default or migration changes.
Use existing adapters; do not recolor all primary actions or add a second theme.

## Implementation and evidence checklist

Work and per-record acceptance are tracked under
`temp/local/2026-10-28-theme-redesign/`; captures/checks are under the matching
`temp/verification/` directory. The canonical coordinator TODO remains read-only.

- Implemented: distinct light/dark canvas/panel/reading/raised surface hierarchy,
  stronger contrast-scaled edges, accent-aware selected fill/navigation/focus,
  ordinary text selection pair, readable control borders/disabled fields,
  system forced-colors focus and enabled selection treatment. Existing shared
  popup backdrop/solid rules consume the raised surface. Solid action pairs
  change atomically; inverse island focus follows its own light ink. Status text
  and chip surfaces adapt to brighter custom dark canvases while keeping their
  hue and original solid-action palettes.
- 2026-10-28 polish (uncommitted): dark hover/pressed lowered to 13%/17% so
  hover reads clearly below selected (Settings nav oklab L: panel .18, hover .25,
  selected .35); structural stroke 2x → 1.5x to quiet list dividers while pane
  edges keep `--ui-pane-border`; dark field edge 52% → 44%, light keeps 52%
  (minimum resting field border 3.30 dark / 3.32 light). Settings category
  navigation adopts the panel surface and pane edge (`BycodaSettings.css`).
  Evidence: `temp/verification/2026-10-28-theme-polish/` (fixture only).
- Verify actual adapters and Sidebar, SettingsView and ServersView at light/dark
  1280/800; capture visible viewport pieces rather than clipped oversized nodes.
- Verify multiple accent extremes, custom tint, contrast and density preferences,
  computed text/focus/control/selection contrast and forced colors.
- Keep general DOM selection, overlay glyphs, CodeMirror/PDF/xterm boundaries
  explicit; test source is not evidence that a runtime case passed.

Final per-surface results and remaining checks belong in the handoff, not inferred
from this implementation list. Installed/native/physical-device/screen-reader
acceptance stays open until actual evidence exists.

## Verified packet, 2026-10-28

Current working-tree source is fingerprinted in
`temp/local/2026-10-28-theme-redesign/handoff.json`; audit-by-audit results and
light/dark 1280/800 links are in the adjacent `RECORDS.md`. Four rebuilt fixture
bundles include the tested roles. Actual Sidebar/ProjectRail, SettingsView,
ServersView/detail/mock terminal, shared controls and settled Settings popup were
captured. Root independently inspected the code, helpers, measurements and
representative images after native-subagent validation.

54 Appearance/model/preference/hook/adapter tests passed. Browser checks passed
for four component fixtures, 28 status text measurements and the synthetic inverse
island contract. Measured minimums: action/range 4.944:1, focus 3.974:1, resting
field boundary 3.318:1, custom tint focus 3.610:1 and status text 4.628:1. Toolbar/
form heights remain 28/36, 32/40 and 44/44 at compact/comfortable/touch density.
Forced-colors checks use Chromium emulation; custom non-blue accents/tint/density
are DOM probes. They do not prove picker persistence, every possible custom color,
native glass, reader/device, live Host/SSH or installed acceptance. Candidate
probe files are not implementation evidence. No canonical TODO was changed.

## Dependencies and handoff

SEL-03 normal Composer Send/steer needs `tone="accent"` in its owning source.
SEL-09/APP-04 durability feedback and Appearance preview need the settings owner.
CMP-08 selected versus drop identity, CMP-14 local menu recipes and whole UIF
family delivery remain with their control/overlay owners. Shared theme work does
not automatically close those records, SH01 shell behavior or T3UI-07/08 product
and native coverage. Source is uncommitted until the owner directs delivery.

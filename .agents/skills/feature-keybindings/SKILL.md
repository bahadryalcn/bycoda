---
name: feature-keybindings
description: Settings Keybindings inventory for focused and contextual app shortcuts, macOS global Quick composer, capture, conflict reservations, override persistence, native menu registration, sibling sync, focus ownership and filter/reset behavior.
---

# Keybindings and shortcut recording

## CI regression repair, 2026-11-01

Release-performance implementation found a real conflict-state layout defect:
the shared full-row alert rule overrode the local icon feedback slot and collapsed
the recorder under Reset. `ShortcutSettings.module.css` now retains that slot and
lets the label/editor wrap without changing shortcut values or interaction rules.
`tests/browser/settings.e2e.ts` asserts usable recorder width and separate Reset
hit areas before normal keyboard/pointer interaction. Twelve scenarios passed in
light/dark at 390/768/800/1024/1280/1440; all six conflict captures at
390/800/1280 were opened and inspected. Twelve editor unit cases also passed.
Evidence: `temp/verification/2026-11-01-release-performance/keybindings-conflict/`.
Local source/fixture evidence only; baseline main/cba4505fe, uncommitted per owner
instruction. OS shortcut registration and installed-build inclusion were not tested.


## Purpose and keywords

Make app/context/global shortcuts discoverable, editable and recoverable without
losing existing bindings or focus. Keywords: Keybindings, shortcut, hotkey,
record/capture, Ctrl/Command, Quick composer, override, reset, disabled, unassigned,
conflict, focused/recording, category/status filter. Shared filter language is a
cross-feature dependency, not ownership of every collection's filter model.

## Inventory and coordination

2026-10-27 source baseline main d8bf868fae841b8b391ce148487cd7d373ea9762. T2 audit
only:14 records,18 families;10 representative desktop filters plus one native
pattern/consumer. Source/runtime, focus and filter subagents were read-only;
root writes documents. No live feature-claim capability was exposed; available
worktree/session context was consulted. This card is not a reservation. Shared
Button.module.css has concurrent staged joined-group work; preserve it.
Native lib.rs has concurrent Host transport registration/window cleanup; preserve
that work and treat both files as snapshot-only evidence.

Search roots: src/features/settings, src/shared/ui, src/styles, src/app,
src/features/quick-composer, src-tauri, tests/browser, mobile/app and mobile/src.
Search identifiers: KEYBINDINGS, KeybindingsPage, keybindingSettingId,
filterKeybindings, keybindings_set_overrides, setQuickComposerShortcut,
bycoda.keybindingOverrides, ShortcutRecorder, focusOwner, ListFilter.

## Surface/state inventory

- Settings page/recorder/editor/row/filter/help: `src/features/settings/ui/ShortcutSettings.tsx`
  and `ShortcutSettings.module.css`; route `src/features/settings/ui/SettingsView.tsx:497`.
- Page/row catalog and reveal index, keybinding defaults/override storage,
  conflicts/query, Quick composer enabled/chord: `src/features/settings/model/settings.ts`.
- App resolution and live tooltip labels: `src/features/settings/model/appShortcuts.ts`,
  `src/features/settings/model/useKeybindingShortcut.ts`; runtime workspace input
  `src/app/workspace/input/useWorkspaceKeyboardShortcuts.ts`.
- Shared adapter `src/shared/ui/ShortcutRecorder.tsx`; primitive and CSS under
  `src/shared/ui/arc/shortcut-recorder/`; shared Button, TextField, SearchInput,
  Select, SearchableSelect, Popover and overlay own standard controls/lifecycle.
- Focus/surface mapping `src/styles/arc.css`, `src/styles/index.css`; consult
  docs/reference/arc-ui.md, ui-design-system.md, ui-component-catalog.md and DESIGN.md.
- Native command `keybindings_set_overrides`: `src-tauri/src/menu.rs:80`;
  registration `src-tauri/src/lib.rs:885`. macOS global API owner
  `src/features/quick-composer/model/quickComposer.ts`, native
  `src-tauri/src/quick_composer.rs:266`. Quick composer is a macOS-only catalog row.
- No new Host RPC/tool. No native mobile Keybindings route was found in the
  searched roots. Platform applicability does not imply every mobile filter was
  audited. Native filter dependency: `mobile/src/ui/filter-sheet.tsx`,
  `mobile/src/features/inbox/provider-browse.tsx`; retain staged Reset/Apply.
- Locale families: Filter keybindings, Filters, Category/Status, Modified,
  Disabled/Unassigned, No matching bindings, Reset filters, Shortcut help,
  Saving/Saved, Record shortcut, Change/Reset shortcut, Del disables/Esc cancels.
  Some model error strings remain raw English; audit does not fix them.
- Tests: `src/features/settings/ui/QuickComposerShortcutEditor.test.ts`,
  `src/features/settings/model/settings.test.ts`, `appShortcuts.test.ts`,
  `useKeybindingShortcut.test.ts`, shared `src/shared/ui/Button.test.ts`,
  `Popover.test.ts`; optional follow-up model `src/features/quick-composer/model/quickComposerShortcut.test.ts`.
- Existing browser fixture `tests/browser/settings.e2e.ts:271`,
  `tests/browser/settings.html`; layout `tests/browser/settings-layout.e2e.ts`.
  These are fixture evidence, not native registration/OS/installed acceptance.
- Full18-family state checklist and explicit filter exclusions:
  `temp/local/2026-10-27-settings-keybindings-audit/AUDIT.md`.

## Owner decisions

2026-10-27, conversation0567326f-aade-4baa-89f3-b44c6256ae9e, exact text excerpts
separated by images:

> buranında tasarım anlayışı kötü fokus olunca

> bu şekilde filan gözüküyor arka plan filan hepsi aynı mide bulandırıyor

> filtreler filanda genel olarak iyi değil zaten hiç bir yerde

This requests Keybindings/shared focus/filter review in the staged Settings
audit. No palette, capture-entry, chord reservation, reset/persistence default or
global OS registration change is selected by the owner.

## Behavior to preserve

Default/custom/disabled/unassigned, category/context scope, native menu versus
app-focused/global distinctions, platform labels and conditional macOS row.
IME/repeat exclusion, held modifier preview, Escape/Tab/blur, bare Delete/Backspace
disable, listener cleanup, pending serialization, local feedback and reset.
Conflict validation before global registration and current reserved-default
policy. Disabled Quick composer editing stays disabled; its Reset restores the
enabled default. Native replacement retains/restores old hotkey on failure.
Ordinary override persistence throws and attempts native rollback; keep its
same-window/sibling subscriptions and live tooltip updates while repairing gaps.

Retained query/category/status, Settings reveal, visible result scope, drafts,
focus return, nested/native overlays and accessible names must survive redesign.
Selected/hover/focus/recording/error are different states. Shared filters retain
domain selection, paging/query epochs, reset scope and View preferences; desktop
immediate changes and native mobile staged Apply must not be conflated.

## Checks and acceptance

Fresh audit run:99 existing tests/six suites, detailed command/log under
`temp/verification/2026-10-27-settings-keybindings-audit/`. Shared Button/Popover
plus shortcut UI/model tests passed. No new repair tests or app implementation.
Static detector/file-hash/document checks are not runtime accessibility proof.

For implementation, capture each changed surface light/dark1280/800; add narrow,
long locale, zoom, keyboard/reader, forced colors, coarse pointer and reduced
motion. Exercise focus versus deliberate capture, modifiers, cancel/disable/reset,
conflict, native/storage/rollback failure and sibling/restart. Use isolated stores
and native data; do not change real owner shortcuts. Replace the fixture's >98%
width assertion while preserving its behavior checks. Check generated bundle and
installed source identity before treating old screenshots as current defects.

## Known blockers and handoff

Audit/design is complete locally, uncommitted; no product, OS, preference, native,
Host, build/install/release change. Installed inclusion UNKNOWN. Actual changed
app captures, platform registration, forced-color/contrast/reader and mobile
journeys await implementation/isolated runs. Claims coordination remains with the
implementer/shared-control owners; no local card substitutes for it.
Baseline is immutable source reference, not delivered-fix commit. Evidence and
named unverified checks are in EVIDENCE.md beside source-snapshot.json.

## Proposals

Bounded command/chord track; one focus owner and clear capture/pending/error;
visible popup labels/short help; explicit reset/query scopes. Evaluate deliberate
capture entry separately from styling. Repair Quick composer durability/external
sync and app native partial outcomes; localize errors. Shared filter grammar,
truthful count scope and separate View section through existing controls. Ten
reviewed desktop families and native pattern are a first migration inventory,
not whole-product completion. Exact briefs and main-plan Y:
`temp/local/2026-10-27-settings-keybindings-audit/REDESIGN.md`,
`temp/local/2026-10-27-workbench-audit/PLAN.md`.

## H3 Settings pages A implementation, 2026-10-28

Uncommitted Keybindings source now bounds the command/chord track and uses the
shared Group/Row geometry without local row skins or density-token overrides.
Filters show Category/Status labels, active values and truthful shown/total
scope. Popup Reset filters remains filters-only; empty recovery explicitly clears
search and filters. Existing retained state, reveal, recording/IME/modifier,
Tab/Escape/blur, disable/reset and reservation policy are preserved.

Quick composer now consumes root-written durable enabled/chord receipts and
same-/sibling-window chord subscriptions. Editor and parent update without
remounting active capture drafts. Failed persistence attempts restore previous
storage/native state and refresh displayed values; original and rollback errors
remain visible. Ordinary native/app saves also attempt rollback after partial
native rejection and retain both failure causes. Native rollback is not atomic,
and no native read-back operation is claimed. UI error context is localized;
existing model validation detail remains an explicit localization dependency.

Files: settings/ui/ShortcutSettings.tsx and ShortcutSettings.module.css;
root owns the narrow settings.ts QuickComposer receipt/subscription edits.
QuickComposerShortcutEditor regression source was added; **test edilmedi**.
No tests/compiler/browser/native hotkey or owner preference operation was run by
this writer. Root owns the final compiler. Shared recorder focus/keycap visuals
and focus-triggered capture remain H1 contracts (KB-02/04); browser geometry and
native partial-failure acceptance remain pending. Per-ID report and morning
matrix: `temp/local/2026-10-28-settings-pages-a/personal.json`.

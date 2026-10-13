# Arc UI integration

Arc source is installed with the project-pinned shadcn CLI into `src/shared/ui/arc/`.
`components.json` registers `@uiarc` and maps components to `src/shared/ui`.

```powershell
pnpm exec shadcn add @uiarc/<component>
```

Review the registry item and its dependencies before installing. Do not pass
`--overwrite` to an adapted item without reviewing the local changes below.

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

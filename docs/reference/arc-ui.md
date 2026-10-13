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

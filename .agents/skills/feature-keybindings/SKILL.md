---
name: feature-keybindings
description: "Change bycoda shortcut capture, conflict checks, override persistence or global registration. Preserve IME/focus behavior and app/context/native shortcut distinctions."
---

# Keybindings development

All code paths below are repository-relative; linked skill resources are relative to this directory.

## When to use

Use for Settings Keybindings, shortcut defaults/overrides, app dispatch and macOS Quick composer global shortcuts. Shared focus/filter presentation follows shared UI guidance; this card does not own every feature's filter model.

## Start here

- `src/features/settings/ui/ShortcutSettings.tsx` and `src/shared/ui/ShortcutRecorder.tsx` own editing/recording.
- `src/features/settings/model/settings.ts`, `appShortcuts.ts` and `useKeybindingShortcut.ts` own defaults, resolution and subscriptions.
- Read [surfaces](references/surfaces.md) for runtime/native dispatch, storage and targeted checks.

## Preserve

- Keep default/custom/disabled/unassigned values, category/context scope and platform labels distinct; app-focused, native-menu and global shortcuts are different owners.
- Preserve IME/repeat exclusion, modifier preview, explicit capture behavior, Escape/Tab/blur, bare Delete/Backspace disabling and listener cleanup.
- Validate conflicts and reserved bindings before registration; do not silently broaden which chords can override existing commands.
- Retain duplicate/pending serialization and old native binding restoration on failure. Persistence/native rollback can partially fail; preserve both failure causes.
- Preserve stored overrides, same-/sibling subscriptions and live tooltip labels; a saved preference alone does not prove OS registration.
- Keep query/category/status, search reveal, draft focus and nested/native overlays through layout changes; filter reset and clearing all query/filter state have different scopes.
- macOS Quick composer editing depends on its enabled state and actual platform; Reset retains its established enabled/default semantics.
- Conflict/error/pending rows must leave recorder and Reset independently usable at narrow widths; use shared focus ownership rather than adding a competing ring.

## Workflow and checks

1. Trace the chord from catalog/storage through app dispatch or native/global registration and back to displayed labels; identify which boundary the defect actually crosses.
2. Use [Arc focus ownership](../../../docs/reference/arc-ui.md) and [shared component contracts](../../../docs/reference/ui-component-catalog.md) for presentation; retain capture semantics.
3. Select recorder/model/runtime tests from the map; exercise cancel/disable/reset/conflict, storage/native rollback, sibling refresh and usable hit areas using isolated preference stores. OS registration needs actual native checks.

## Read when needed

- Read [surfaces](references/surfaces.md) for keys, commands and verification starting points.
- For a queue shortcut defect compare the persisted chord, focus and open composer popovers before changing queue transport; read [composer](../feature-chat-composer/SKILL.md) if execution changes.

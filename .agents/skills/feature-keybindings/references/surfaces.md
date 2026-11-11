# Keybindings surfaces

All source paths are repository-relative.

| Area                           | Owner                                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page/rows/filter/editor        | `src/features/settings/ui/ShortcutSettings.tsx`, `ShortcutSettings.module.css`                                                                                                      |
| Catalog/defaults/overrides     | `src/features/settings/model/settings.ts`; `bycoda.keybindingOverrides`; verify migrations and conflict policy in the model                                                         |
| App resolution/live labels     | `src/features/settings/model/appShortcuts.ts`, `useKeybindingShortcut.ts`; `src/app/workspace/input/useWorkspaceKeyboardShortcuts.ts`                                               |
| Recorder                       | `src/shared/ui/ShortcutRecorder.tsx`; `src/shared/ui/arc/shortcut-recorder/`                                                                                                        |
| Native menus                   | `src-tauri/src/menu.rs`; `keybindings_set_overrides`, registered in `src-tauri/src/lib.rs`                                                                                          |
| Global Quick composer          | `src/features/quick-composer/model/quickComposer.ts`, `quickComposerShortcut.ts`; `src-tauri/src/quick_composer.rs`                                                                 |
| Global computer emergency Stop | `src/features/settings/model/desktopStopKeybinding.ts`, `src/features/host-tools/desktopStopShortcut.ts`; `src-tauri/src/desktop_shortcut.rs`; exact `native.services.desktop.stop` |

## Interaction and scope

- Inspect `KEYBINDINGS`, `keybindingSettingId`, `filterKeybindings`, Quick composer enabled/chord ownership and focusOwner consumers before changing labels or capture.
- Resetting ordinary override and resetting Quick composer can have different enabled/default consequences. Preserve current validation and native replacement rollback rather than copying one handler to the other.
- Shared filters keep feature selection/count/query/reset semantics. Mobile staged Apply behavior (for example `mobile/src/ui/filter-sheet.tsx`) does not define desktop immediate-filter behavior.
- Do not infer a mobile Keybindings management screen or new Host shortcut RPC from a native command. Follow actual callers when extending platform scope.

## Focused checks

- Editor/model: `src/features/settings/ui/QuickComposerShortcutEditor.test.ts`; `src/features/settings/model/settings.test.ts`, `appShortcuts.test.ts`, `useKeybindingShortcut.test.ts`; `src/features/quick-composer/model/quickComposerShortcut.test.ts`.
- Runtime: `src/app/workspace/input/useWorkspaceKeyboardShortcuts.test.ts`; recorder/shared control tests when those APIs change.
- Browser: `tests/browser/settings/settings.e2e.ts`, `settings-layout.e2e.ts` and current Settings config. Include conflict state recorder width and separate Reset hit areas, not just the idle row.
- Check keyboard capture, modifiers, IME, cancel/blur, disabled/unassigned, reserved conflicts, pending deduplication, storage/native partial failure and rollback, sibling/restart labels and nested popovers. Use isolated data; never overwrite owner shortcuts to test UI.

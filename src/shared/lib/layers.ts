/**
 * One z-index scale for everything that floats over the app chrome. Panels and
 * buttons inside a surface stay below 50; anything that escapes its pane —
 * menus, dialogs, toasts — picks a layer from here so the order is decided in
 * one place instead of by whichever stray `z-50` was written last.
 *
 * CSS reads the same scale as `--layer-<kebab-name>` on `:root` (src/styles/index.css,
 * e.g. `z-index: var(--layer-popover)`). Keep both lists identical: add or change a layer
 * in both places.
 */
export const LAYER = {
  /** In-pane surfaces (a sheet over a session pane): above pane content, below every floating layer. */
  paneSheet: 40,
  /** Hover cards that float over a pane (editor blame card) but stay below menus. */
  hoverCard: 60,
  /** Anchored menus, dropdowns, and pickers. */
  popover: 80,
  /** A flyout hung off an open popover. */
  submenu: 81,
  /** Modal dialogs and the command palette. */
  dialog: 90,
  /** Menus opened from controls inside a modal dialog. */
  dialogPopover: 91,
  /** Toasts, which outrank whatever they interrupt. */
  toast: 100,
  /** Menus and pickers opened from a toast: just above the toast stack. */
  toastPopover: 101,
  /** Pointer drag previews and drop hints, which must follow the pointer over everything. */
  drag: 2147483647,
} as const;

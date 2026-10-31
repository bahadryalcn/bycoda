import { forwardRef } from "react";
import {
  ShortcutKbd as ArcShortcutKbd,
  ShortcutKeys as ArcShortcutKeys,
  type ShortcutKbdProps,
  type ShortcutKeysProps,
} from "./arc/shortcut-recorder/shortcut-keys";

export type { ShortcutKbdProps, ShortcutKeysProps };

/** A single key cap for inline hints, menus and help. Prefer `ShortcutKeys` for a whole combination. */
export const ShortcutKbd = forwardRef<HTMLElement, ShortcutKbdProps>(function ShortcutKbd(
  { className, ...props },
  ref,
) {
  return (
    <ArcShortcutKbd
      {...props}
      ref={ref}
      className={["bycoda-arc", className].filter(Boolean).join(" ")}
    />
  );
});

/**
 * A shortcut as platform-aware key caps with a spoken label: a canonical binding (`mod+k`) or a
 * display label (`Ctrl+Shift+P`, `⌘⇧P`, `Esc Esc`, `Shift+Enter / Shift+F3`). It reads keys
 * through the one formatter in `./shortcut`, the same one Button/Tooltip hints and DropdownMenu
 * shortcut slots use.
 */
export function ShortcutKeys({ className, ...props }: ShortcutKeysProps) {
  return (
    <ArcShortcutKeys {...props} className={["bycoda-arc", className].filter(Boolean).join(" ")} />
  );
}

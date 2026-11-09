import { forwardRef } from "react";
import {
  ShortcutKbd as ArcShortcutKbd,
  ShortcutKeys as ArcShortcutKeys,
  type ShortcutKbdProps,
  type ShortcutKeysProps,
} from "./arc/shortcut-recorder/shortcut-keys";

export type { ShortcutKbdProps, ShortcutKeysProps };

/**
 * One key cap for inline hints, menus and help text.
 * @group text
 * @use Show a single key (Esc, Enter) inside a sentence or hint.
 * @avoid A whole combination such as mod+k: ShortcutKeys.
 * @replaces kbd
 * @arc shortcut-recorder
 */
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
 * @group text
 * @use Show a keyboard shortcut in help, settings or a hint, spelled for the user's platform.
 * @avoid One standalone key: ShortcutKbd. Capturing a new binding: ShortcutRecorder.
 */
export function ShortcutKeys({ className, ...props }: ShortcutKeysProps) {
  return (
    <ArcShortcutKeys {...props} className={["bycoda-arc", className].filter(Boolean).join(" ")} />
  );
}

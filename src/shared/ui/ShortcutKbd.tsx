import { forwardRef } from "react";
import {
  ShortcutKbd as ArcShortcutKbd,
  ShortcutKeys as ArcShortcutKeys,
  type ShortcutKbdProps,
  type ShortcutKeysProps,
} from "./arc/shortcut-recorder/shortcut-recorder";

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

/** A shortcut string (for example `Mod+K`) as platform-aware key caps with a spoken label. */
export function ShortcutKeys({ className, ...props }: ShortcutKeysProps) {
  return (
    <ArcShortcutKeys {...props} className={["bycoda-arc", className].filter(Boolean).join(" ")} />
  );
}

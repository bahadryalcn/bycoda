"use client";

import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { useT } from "../../../i18n";
import { formatShortcutLabelWith, usePlatform, type Platform } from "../../shortcut";
import styles from "./shortcut-recorder.module.css";

/* ================================================================================================
 * ShortcutKbd and ShortcutKeys
 * ============================================================================================== */

export interface ShortcutKbdProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Draws the key pushed down and lit, such as while it is held. */
  pressed?: boolean;
  size?: "xs" | "sm" | "md";
}

/** A key cap. Use it inline in copy, in menus, or through `ShortcutKeys` for a whole combination. */
export const ShortcutKbd = forwardRef<HTMLElement, ShortcutKbdProps>(function ShortcutKbd(
  { children, pressed = false, size = "md", className, ...props },
  ref,
) {
  return (
    <kbd
      ref={ref}
      {...props}
      className={[styles.kbd, className].filter(Boolean).join(" ")}
      data-size={size}
      data-pressed={pressed || undefined}
    >
      {children}
    </kbd>
  );
});
ShortcutKbd.displayName = "ShortcutKbd";
/** @deprecated Renamed to `ShortcutKbd` so it never clashes with the `kbd` component's `Kbd` in a shared index.ts. */
export const Kbd = ShortcutKbd;
/** @deprecated Renamed to `ShortcutKbdProps`. */
export type KbdProps = ShortcutKbdProps;

export interface ShortcutKeysProps {
  shortcut: string;
  platform?: Platform;
  /** Held key ids from `usePressedKeys`; matching caps light up. */
  pressed?: ReadonlySet<string>;
  size?: "xs" | "sm" | "md";
  className?: string;
}

/**
 * A shortcut as key caps, with a spoken label for assistive technology. Accepts a canonical
 * shortcut ("mod+shift+k") or a display label ("Ctrl+Shift+K", "⌘⇧K", "Esc Esc",
 * "Shift+Enter / Shift+F3"); sequences keep a wider gap and alternatives a "/" between them.
 */
export function ShortcutKeys({
  shortcut,
  platform: platformProp,
  pressed,
  size = "md",
  className,
}: ShortcutKeysProps) {
  const t = useT();
  const platform = usePlatform(platformProp);
  const { alternatives, spoken } = formatShortcutLabelWith(shortcut, platform, t);
  return (
    <span
      className={[styles.keys, className].filter(Boolean).join(" ")}
      role="img"
      aria-label={spoken}
    >
      {alternatives.map((sequence, alternative) => [
        alternative > 0 ? (
          <span key={`or-${alternative}`} className={styles.keysSeparator} aria-hidden="true">
            /
          </span>
        ) : null,
        sequence.map((chord, step) =>
          chord.map((token, index) => (
            <ShortcutKbd
              key={`${alternative}-${step}-${index}-${token.id}`}
              size={size}
              pressed={pressed?.has(token.id)}
              data-sequence-start={step > 0 && index === 0 ? "" : undefined}
              aria-hidden="true"
            >
              {token.label}
            </ShortcutKbd>
          )),
        ),
      ])}
    </span>
  );
}

import type { ComponentPropsWithoutRef } from "react";
import styles from "./Spinner.module.css";

export type SpinnerSize = "xs" | "sm" | "md";

export type SpinnerProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  /** `sm` (default) matches `icon-sm` (14px), `xs` `icon-xs` (12px), `md` `icon-md` (16px). */
  size?: SpinnerSize;
  /** Accessible name. Omit when the initiating control already announces progress (aria-busy). */
  label?: string;
  /**
   * Inside running text or a label: the glyph follows the surrounding font size (1em) and sits
   * on the text line instead of the icon box. `size` is ignored.
   */
  inline?: boolean;
};

/**
 * The one pending glyph: icon-scale size from shared tokens, `currentColor`, no
 * rotation under reduced motion. Place it on the control that started the work.
 * Do not spin a lucide `Loader`/`LoaderCircle` icon with `animate-spin`; use this.
 */
export function Spinner({ size = "sm", label, inline = false, className, ...props }: SpinnerProps) {
  return (
    <span
      {...props}
      className={[styles.spinner, className].filter(Boolean).join(" ")}
      data-size={inline ? "inline" : size}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

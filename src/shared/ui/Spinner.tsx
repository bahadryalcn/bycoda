import type { ComponentPropsWithoutRef } from "react";
import styles from "./Spinner.module.css";

export type SpinnerSize = "xs" | "sm" | "md";

export type SpinnerProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  /** `sm` (default) matches a 14px icon, `xs` 12px, `md` the form icon size. */
  size?: SpinnerSize;
  /** Accessible name. Omit when the initiating control already announces progress (aria-busy). */
  label?: string;
};

/**
 * The one pending glyph: icon-scale size from shared tokens, `currentColor`, no
 * rotation under reduced motion. Place it on the control that started the work.
 */
export function Spinner({ size = "sm", label, className, ...props }: SpinnerProps) {
  return (
    <span
      {...props}
      className={[styles.spinner, className].filter(Boolean).join(" ")}
      data-size={size}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

import type { HTMLAttributes } from "react";
import type { BadgeTone } from "./Badge";
import styles from "./StatusDot.module.css";

export interface StatusDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  tone?: BadgeTone | "secondary";
  /** Meaning of a standalone dot; omit when adjacent text already provides it. */
  label?: string;
  size?: "sm" | "md" | "compact" | "fixed";
  /** Use the stronger solid status colors. */
  appearance?: "foreground" | "solid";
  /** Keep the surrounding control's existing forced-color behavior. */
  preserveColors?: boolean;
}

/** Static status mark for dense rows. Class names own placement, never appearance. */
export function StatusDot({
  tone = "accent",
  label,
  size = "sm",
  appearance = "foreground",
  preserveColors = false,
  className,
  ...props
}: StatusDotProps) {
  return (
    <span
      {...props}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={props["aria-hidden"] ?? (label ? undefined : true)}
      data-tone={tone}
      data-size={size}
      data-appearance={appearance}
      data-preserve-colors={preserveColors || undefined}
      className={["bycoda-arc", styles.dot, className].filter(Boolean).join(" ")}
    />
  );
}

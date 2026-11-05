import type { HTMLAttributes } from "react";
import type { BadgeTone } from "./Badge";
import styles from "./StatusDot.module.css";

export interface StatusDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  tone?: BadgeTone;
  /** Required meaning; dots never communicate through color alone. */
  label: string;
  size?: "sm" | "md";
}

/** Static status mark for dense rows. Class names own placement, never appearance. */
export function StatusDot({
  tone = "accent",
  label,
  size = "sm",
  className,
  ...props
}: StatusDotProps) {
  return (
    <span
      {...props}
      role="img"
      aria-label={label}
      data-tone={tone}
      data-size={size}
      className={["bycoda-arc", styles.dot, className].filter(Boolean).join(" ")}
    />
  );
}

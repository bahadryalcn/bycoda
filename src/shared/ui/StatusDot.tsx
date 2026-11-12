import type { HTMLAttributes } from "react";
import type { BadgeTone } from "./Badge";
import styles from "./StatusDot.module.css";

export interface StatusDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  tone?: BadgeTone | "secondary" | "added" | "removed";
  /** Meaning of a standalone dot; omit when adjacent text already provides it. */
  label?: string;
  /** Compatibility names; every static status dot uses the same compact 6px mark. */
  size?: "sm" | "md" | "compact" | "fixed";
  /** Compatibility policy name; dots always use the shared foreground tone. */
  appearance?: "foreground" | "solid";
  /** Keep the surrounding control's existing forced-color behavior. */
  preserveColors?: boolean;
}

/**
 * Small static status circle for dense rows. Owns size, tone color and the image role: with `label` it is a
 * named `img`, without it it is decorative (adjacent text must carry the meaning). Class names place it only.
 * @group feedback
 * @use Presence or status mark next to a row, tab or avatar (online, unread, pending approval).
 * @avoid Labeled status text: Badge or StatusBadge. Loading or progress: Spinner or Progress. Unsaved tab mark: TabDirtyDot.
 */
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

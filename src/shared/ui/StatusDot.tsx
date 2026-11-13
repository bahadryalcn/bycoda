import type { HTMLAttributes } from "react";
import type { BadgeTone } from "./Badge";
import styles from "./StatusDot.module.css";

export interface StatusDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  tone?: BadgeTone | "secondary" | "muted" | "added" | "removed";
  /** Meaning of a standalone dot; omit when adjacent text already provides it. */
  label?: string;
  /** Compatibility names; every static status dot uses the same compact 6px mark. */
  size?: "sm" | "md" | "compact" | "fixed";
  /** Standard dots use foreground ink. attention is an 8px new-feature mark with surface halo and reduced-motion-aware pulse. */
  appearance?: "foreground" | "solid" | "attention" | "presence";
  /** Hollow offline presence uses the parent ink. */
  hollow?: boolean;
  /** An 8px rotated status mark with a surface cutout. */
  shape?: "diamond";
  /** Optional 2px surround when placed over a floating surface. */
  halo?: "floating";
  /** Keep the surrounding control's existing forced-color behavior. */
  preserveColors?: boolean;
}

/**
 * Compact status circle for dense rows; attention marks add an 8px discovery pulse. Owns size, tone color and the image role: with `label` it is a
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
  halo,
  shape,
  hollow,
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
      data-halo={halo}
      data-shape={shape}
      data-hollow={hollow || undefined}
      className={["bycoda-arc", styles.dot, className].filter(Boolean).join(" ")}
    />
  );
}

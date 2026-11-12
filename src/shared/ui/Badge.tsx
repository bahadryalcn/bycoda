import type { CSSProperties, ReactNode } from "react";
import { useT } from "../i18n";
import {
  Badge as ArcBadge,
  type BadgeProps as ArcBadgeProps,
  type BadgeTone,
  BADGE_COUNT_MAX,
} from "./arc/badge/badge";
import { Check, CircleAlert, CircleX, Clock, RotateCcw } from "./icons";
import { Spinner } from "./Spinner";
import { textAttributes, type TextLeading } from "./Text";
import styles from "./Badge.module.css";

export type { BadgeTone, BadgeVariant, BadgeAppearance } from "./arc/badge/badge";

/** `xs` is the inline metadata size for triggers, rows and tab labels; `sm`/`md` are the Arc sizes. */
export type BadgeSize = "xs" | "sm" | "md";

export type BadgeProps = Omit<ArcBadgeProps, "size"> & {
  size?: BadgeSize;
  minWidth?: CSSProperties["minInlineSize"];
  /** One-line text label: text that does not fit ends in an ellipsis and the badge shrinks
   *  inside its row (it needs a bounded width: a flex or grid item, or `max-w-*`). Applies to
   *  string and number children of a label or dot badge; a capped count never truncates.
   *  Replaces `className="truncate"`. */
  truncate?: boolean;
  /** Line height of the badge; unset keeps its own. `none` 1, `tight` 1.25, `snug` 1.375,
   *  `normal` 1.5, `relaxed` 1.625, `inherit` the surrounding line height. Replaces
   *  `leading-*` classes. */
  leading?: TextLeading;
};

/** Default cap of a `count`: larger numbers render as `99+` and keep the real number as the accessible name. */
export { BADGE_COUNT_MAX };

/**
 * Small pill for a short label, status or count with tone, appearance and optional icon. Sizes `xs` (inline metadata in triggers, rows, tabs), `sm`, `md`. `variant="count"` caps at 99+ and keeps the real number as the accessible name.
 * Domain-to-tone mapping stays with the caller.
 * @group feedback
 * @use Tags, counts and short labels beside content.
 * @avoid Run/job/check status: StatusBadge. A bare coloured dot: StatusDot. A list of names or tags: BadgeList. Clickable chip: Button.
 * @arc badge
 */
export function Badge({
  className,
  minWidth,
  style,
  size = "md",
  max,
  variant,
  tone,
  truncate = false,
  leading,
  children,
  ...props
}: BadgeProps) {
  const badgeTone =
    variant === "count" && tone !== "warning" && tone !== "danger" ? "accent" : (tone ?? "neutral");
  return (
    <ArcBadge
      {...props}
      variant={variant}
      tone={badgeTone}
      size={size === "xs" ? "sm" : size}
      max={max ?? (variant === "count" ? BADGE_COUNT_MAX : undefined)}
      data-size={size}
      data-tone={badgeTone}
      data-variant={variant ?? "label"}
      data-leading={leading}
      style={{ ...style, minInlineSize: minWidth ?? style?.minInlineSize }}
      className={["bycoda-arc", size === "xs" && styles.xs, leading && styles.leading, className]
        .filter(Boolean)
        .join(" ")}
    >
      {truncate &&
      variant !== "count" &&
      (typeof children === "string" || typeof children === "number") ? (
        // The clip sits on the text, a flex item inside the badge, so the ellipsis can render.
        <span {...textAttributes({ truncate: true })}>{children}</span>
      ) : (
        children
      )}
    </ArcBadge>
  );
}

/** The one run/job/check status vocabulary. */
export type BadgeStatus = "failed" | "running" | "retrying" | "done" | "queued" | "warning";

const STATUS_TONE: Record<BadgeStatus, BadgeTone> = {
  failed: "danger",
  running: "accent",
  retrying: "warning",
  done: "success",
  queued: "neutral",
  warning: "warning",
};

/** Tone of a status, for status dots and rows that do not render a StatusBadge. */
export function statusBadgeTone(status: BadgeStatus): BadgeTone {
  return STATUS_TONE[status];
}

function StatusIcon({ status }: { status: BadgeStatus }) {
  switch (status) {
    case "failed":
      return <CircleX strokeWidth={1.75} />;
    case "running":
      return <Spinner size="xs" />;
    case "retrying":
      return <RotateCcw strokeWidth={1.75} />;
    case "done":
      return <Check strokeWidth={1.75} />;
    case "queued":
      return <Clock strokeWidth={1.75} />;
    case "warning":
      return <CircleAlert strokeWidth={1.75} />;
  }
}

/** Localized default label of a status. */
export function useStatusBadgeLabel(): (status: BadgeStatus) => string {
  const t = useT();
  return (status) => {
    switch (status) {
      case "failed":
        return t("Failed");
      case "running":
        return t("Running");
      case "retrying":
        return t("Retrying");
      case "done":
        return t("Done");
      case "queued":
        return t("Queued");
      case "warning":
        return t("Warning");
    }
  };
}

export type StatusBadgeProps = Omit<
  BadgeProps,
  "tone" | "icon" | "variant" | "children" | "label"
> & {
  status: BadgeStatus;
  /** Replaces the standard label (e.g. "Failed · 3"); tone and icon stay fixed by the status. */
  children?: ReactNode;
  /** Icon only (dense rows): the label becomes the accessible name. */
  iconOnly?: boolean;
};

/**
 * One fixed tone, icon and label per status (failed, running, retrying, done, queued, warning), so "Failed" reads the same in every list, row and header. Running uses the shared Spinner. `children` replaces the label; `iconOnly` keeps the label as the accessible name.
 * @group feedback
 * @use Run, job or check status in lists, rows and headers.
 * @avoid Any other tag or count: Badge. Dot-only indicator: StatusDot.
 */
export function StatusBadge({
  status,
  children,
  iconOnly = false,
  size = "sm",
  appearance = "subtle",
  className,
  ...props
}: StatusBadgeProps) {
  const label = useStatusBadgeLabel()(status);
  return (
    <Badge
      {...props}
      size={size}
      appearance={appearance}
      tone={STATUS_TONE[status]}
      icon={<StatusIcon status={status} />}
      label={iconOnly ? label : undefined}
      role={iconOnly ? "img" : props.role}
      data-status={status}
      className={[styles.status, className].filter(Boolean).join(" ")}
    >
      {iconOnly ? null : (children ?? label)}
    </Badge>
  );
}

import type { CSSProperties, ReactNode } from "react";
import { useT } from "../i18n";
import {
  Badge as ArcBadge,
  type BadgeProps as ArcBadgeProps,
  type BadgeTone,
} from "./arc/badge/badge";
import { Check, CircleAlert, CircleX, Clock, RotateCcw } from "./icons";
import { Spinner } from "./Spinner";
import styles from "./Badge.module.css";

export type { BadgeTone, BadgeVariant, BadgeAppearance } from "./arc/badge/badge";

/** `xs` is the inline metadata size for triggers, rows and tab labels; `sm`/`md` are the Arc sizes. */
export type BadgeSize = "xs" | "sm" | "md";

export type BadgeProps = Omit<ArcBadgeProps, "size"> & {
  size?: BadgeSize;
  minWidth?: CSSProperties["minInlineSize"];
};

/** Default cap of a `count`: larger numbers render as `99+` and keep the real number as the accessible name. */
export const BADGE_COUNT_MAX = 99;

/** Concise status presentation; domain-to-tone mapping remains with the caller (or StatusBadge). */
export function Badge({
  className,
  minWidth,
  style,
  size = "md",
  max,
  variant,
  ...props
}: BadgeProps) {
  return (
    <ArcBadge
      {...props}
      variant={variant}
      size={size === "xs" ? "sm" : size}
      max={max ?? (variant === "count" ? BADGE_COUNT_MAX : undefined)}
      data-size={size}
      data-variant={variant ?? "label"}
      style={{ ...style, minInlineSize: minWidth ?? style?.minInlineSize }}
      className={["bycoda-arc", size === "xs" && styles.xs, className].filter(Boolean).join(" ")}
    />
  );
}

/** The one run/job/check status vocabulary. */
export type BadgeStatus = "failed" | "running" | "retrying" | "done" | "queued" | "warning";

const STATUS_TONE: Record<BadgeStatus, BadgeTone> = {
  failed: "danger",
  running: "info",
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
 * One fixed tone, icon and label per status, so "Failed" reads the same in every list, row and header.
 * Running uses the shared Spinner (no rotation under reduced motion).
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

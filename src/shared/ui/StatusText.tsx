import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { StatusGlyph, statusBadgeTone, type BadgeStatus } from "./Badge";
import { textAttributes } from "./Text";
import styles from "./StatusText.module.css";

/** The five status roles: running, needs you (warning), failed (danger), done (success), idle (neutral). */
export type StatusTextTone = "running" | "needs-you" | "failed" | "done" | "idle";

export type StatusTextProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  tone: StatusTextTone;
  /** The one word (already translated). */
  children: ReactNode;
  /** Replaces the tone's standard 14px icon, for example a domain glyph. */
  icon?: ReactNode;
  /** Let longer labels wrap in narrow rows. */
  wrap?: boolean;
};

const STATUS: Record<StatusTextTone, BadgeStatus> = {
  running: "running",
  "needs-you": "warning",
  failed: "failed",
  done: "done",
  idle: "queued",
};

/**
 * Status as a 14px icon and one word in the tone colour, caption size, no pill: running (spinner, accent), needs you
 * (warning), failed (danger), done (success), idle (neutral). The caller maps its domain status to a tone and a label;
 * the tone fixes colour and icon so "Failed" reads the same everywhere.
 * @group feedback
 * @use The state of a run, job, goal, delivery or permission in a row, card or header.
 * @avoid A count, tag or filled label: Badge. Run/job/check status that needs a pill: StatusBadge. A bare dot: StatusDot.
 * @example
 * <StatusText tone="needs-you">{t("Plan ready")}</StatusText>
 */
export function StatusText({ tone, icon, wrap, className, children, ...props }: StatusTextProps) {
  const status = STATUS[tone];
  return (
    <span
      {...props}
      {...textAttributes(
        {
          size: "caption",
          tone: tone === "idle" ? "secondary" : statusBadgeTone(status),
          wrap: wrap ? "anywhere" : undefined,
        },
        [styles.status, className].filter(Boolean).join(" "),
      )}
      data-status={tone}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon ?? <StatusGlyph status={status} size="sm" />}
      </span>
      {children}
    </span>
  );
}

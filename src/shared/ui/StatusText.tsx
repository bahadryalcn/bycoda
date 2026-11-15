import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Check, CircleAlert, CircleX, Clock } from "./icons";
import { Spinner } from "./Spinner";
import styles from "./StatusText.module.css";

/** The five status roles: running, needs you (warning), failed (danger), done (success), idle (neutral). */
export type StatusTextTone = "running" | "needs-you" | "failed" | "done" | "idle";

export type StatusTextProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  tone: StatusTextTone;
  /** The one word (already translated). */
  children: ReactNode;
  /** Replaces the tone's standard 14px icon, for example a domain glyph. */
  icon?: ReactNode;
};

function ToneIcon({ tone }: { tone: StatusTextTone }) {
  switch (tone) {
    case "running":
      return <Spinner size="sm" />;
    case "needs-you":
      return <CircleAlert strokeWidth={1.75} />;
    case "failed":
      return <CircleX strokeWidth={1.75} />;
    case "done":
      return <Check strokeWidth={1.75} />;
    case "idle":
      return <Clock strokeWidth={1.75} />;
  }
}

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
export function StatusText({ tone, icon, className, children, ...props }: StatusTextProps) {
  return (
    <span
      {...props}
      data-tone={tone}
      className={[styles.status, className].filter(Boolean).join(" ")}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon ?? <ToneIcon tone={tone} />}
      </span>
      {children}
    </span>
  );
}

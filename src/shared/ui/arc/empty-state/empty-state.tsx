// Official free Arc registry source, adapted to bycoda shared semantics: one notice motion
// (opacity and a short rise, from ../../Notice) replaces the blur-rise swaps and icon morph.
"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { Folder } from "../../icons";
import { InfoPopover, InfoTooltip } from "../../InfoPopover";
import { noticeEnterClass } from "../../Notice";
import { optionalTextAttributes, type TextRoles } from "../../Text";
import styles from "./empty-state.module.css";

/**
 * Where the state sits. `page` fills an area and centres generously (default);
 * `panel` is a compact centred block inside a side panel or card; `list` is a
 * start-aligned row for a list that has no entries. The primitive only changes
 * density: whether the copy means no data, no match or unavailable is the caller's.
 */
export type EmptyStateContext = "page" | "panel" | "list";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  context?: EmptyStateContext;
  title?: string;
  /** The visible sentence. Omit it (with `help`) when the description sits behind the info affordance. */
  description?: ReactNode;
  /** Explanation shown behind the info affordance next to the title instead of a visible subline. */
  help?: ReactNode;
  /** Description typography; unset preserves context-specific defaults. */
  descriptionText?: TextRoles;
  /** Rendered action row; the shared wrappers build it from structured actions. */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  /** Optional accessible label for the state region. */
  label?: string;
}

export function EmptyState({
  title,
  description,
  help,
  descriptionText,
  action,
  icon,
  className,
  label,
  context = "page",
  ...props
}: EmptyStateProps) {
  const glyph = icon === null ? null : (icon ?? <Folder aria-hidden />);
  const hasDescription =
    description !== undefined &&
    description !== null &&
    description !== false &&
    description !== "";
  return (
    <section
      {...props}
      className={[styles.root, noticeEnterClass, className].filter(Boolean).join(" ")}
      data-context={context}
      aria-label={label ?? props["aria-label"]}
    >
      {glyph ? (
        <div className={styles.icon} aria-hidden="true">
          {glyph}
        </div>
      ) : null}
      <div className={styles.copy}>
        {title ? (
          <div className={styles.heading}>
            <h3>{title}</h3>
            {typeof help === "string" && help ? (
              <InfoTooltip>{help}</InfoTooltip>
            ) : help ? (
              <InfoPopover>{help}</InfoPopover>
            ) : null}
          </div>
        ) : null}
        {hasDescription ? (
          <p {...optionalTextAttributes(descriptionText ?? {})}>{description}</p>
        ) : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </section>
  );
}

export default EmptyState;

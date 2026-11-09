import type { ReactNode } from "react";
import styles from "./DescriptionList.module.css";
import { OverflowTooltip } from "./Tooltip";

/**
 * Key-value list rendered as a `dl` with terms aligned in one column; stacks term over value
 * in narrow containers. Owns term/value ink, gaps and wrapping; items own truncation.
 * `hideTerms` keeps the terms for assistive tech only and never stacks, for compact hover cards
 * where each `DescriptionItem` leads with an `icon`.
 * @group data
 * @use Show a few labelled facts about one subject (details, review summary, connection info).
 * @avoid Many rows with columns or sorting: SortableDataTable. A single value: plain text.
 * @replaces dl
 */
export function DescriptionList({
  columns = 1,
  size = "md",
  hideTerms = false,
  className,
  children,
}: {
  columns?: 1 | 2 | "auto";
  size?: "sm" | "md";
  /** Visually hide every term (screen readers still read it) and keep the two-column layout. */
  hideTerms?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <dl
      data-columns={columns}
      data-hide-terms={hideTerms || undefined}
      className={[
        styles.root,
        size === "sm" ? styles.sm : "",
        columns === 2 ? styles.cols2 : "",
        columns === "auto" ? styles.auto : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </dl>
  );
}

/**
 * One term and value pair inside DescriptionList, grouped in a `div` for valid markup.
 * @group data
 * @status internal
 */
export function DescriptionItem({
  term,
  children,
  truncate = false,
  tooltip,
  monospace = false,
  icon,
}: {
  term: ReactNode;
  /** Leading glyph in the first column; the value cell(s) follow in the second. */
  icon?: ReactNode;
  children: ReactNode;
  /** Single-line ellipsis; the full text opens in the shared overflow tooltip. */
  truncate?: boolean;
  /** Tooltip text for a truncated rich value; a string child is its own tooltip. */
  tooltip?: string;
  monospace?: boolean;
}) {
  const valueClass = [
    styles.value,
    icon ? styles.withIcon : "",
    monospace ? styles.mono : "",
    truncate ? styles.truncate : "",
  ]
    .filter(Boolean)
    .join(" ");
  const tooltipLabel = typeof children === "string" ? children : tooltip;
  return (
    <div className={styles.item}>
      <dt className={styles.term}>{term}</dt>
      {truncate && tooltipLabel ? (
        <OverflowTooltip label={tooltipLabel}>
          <dd className={valueClass}>
            {icon}
            {children}
          </dd>
        </OverflowTooltip>
      ) : (
        <dd className={valueClass}>
          {icon}
          {children}
        </dd>
      )}
    </div>
  );
}

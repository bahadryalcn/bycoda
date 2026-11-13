import type { ComponentPropsWithRef } from "react";
import { useFormat } from "../i18n";
import styles from "./DiffStat.module.css";
import { textAttributes, type TextSize } from "./Text";

export type DiffStatProps = Omit<ComponentPropsWithRef<"span">, "children"> & {
  additions: number;
  deletions: number;
  /** Show a side whose count is zero (`+0`); by default a zero side is left out. */
  showZero?: boolean;
  /** Type size from the shared scale; `inherit` (default) follows the surrounding text. */
  size?: TextSize;
  /** Weight; unset keeps the surrounding weight. */
  weight?: "regular" | "medium";
};

/**
 * The size of a change as added and removed line counts in the diff inks: `+12 −3`. Numbers are
 * grouped and tabular so a column of rows lines up. Renders nothing when both sides are left out.
 * `className` is for placement.
 * @group text
 * @use The line counts of a file, commit, pull request or session change.
 * @avoid A change-kind letter or a changed line: Text with tone="added" or tone="removed". A count that is not a diff: Badge or Text.
 * @example
 * <DiffStat additions={file.additions} deletions={file.deletions} />
 * <DiffStat additions={totals.additions} deletions={totals.deletions} showZero weight="medium" />
 */
export function DiffStat({
  additions,
  deletions,
  showZero = false,
  size = "inherit",
  weight,
  className,
  ...props
}: DiffStatProps) {
  const format = useFormat();
  const added = showZero || additions > 0;
  const removed = showZero || deletions > 0;
  if (!added && !removed) return null;
  return (
    <span
      {...props}
      {...textAttributes({ size, weight }, [styles.stat, className].filter(Boolean).join(" "))}
    >
      {added ? (
        <span data-side="added">
          +{format.formatNumber(additions, { maximumFractionDigits: 0 })}
        </span>
      ) : null}
      {removed ? (
        <span data-side="removed">
          −{format.formatNumber(deletions, { maximumFractionDigits: 0 })}
        </span>
      ) : null}
    </span>
  );
}

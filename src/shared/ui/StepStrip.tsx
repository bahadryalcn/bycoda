import type { ComponentPropsWithRef } from "react";
import styles from "./StepStrip.module.css";

export type StepStripCell = "done" | "failed" | "active";

/** Newest cells that stay visible as the strip narrows, so each cell stays readable. */
const COMPACT_CELLS = 12;
const TIGHT_CELLS = 8;

/**
 * The newest steps of a run as a row of small cells, oldest first, with failed and current steps
 * marked. Decorative: the owner states the counts in text, so this stays hidden from assistive tech.
 * Narrow strips keep the newest 12 cells, the narrowest the newest 8.
 * @group data
 * @use Show the recent outcome of a run's discrete steps beside a text count.
 * @avoid A known completion amount: Progress. Usage against capacity: Meter. A single state: StatusDot.
 *
 * @example
 * <StepStrip cells={["done", "failed", "active"]} />
 */
export function StepStrip({
  cells,
  capacity = 20,
  className,
  ...props
}: Omit<ComponentPropsWithRef<"span">, "children"> & {
  /** Steps oldest first; only the newest `capacity` are drawn. */
  cells: readonly StepStripCell[];
  /** Cells reserved in the row, so an early run does not change the strip's rhythm. */
  capacity?: number;
}) {
  const recent = cells.slice(-capacity);
  const empty = capacity - recent.length;
  return (
    <span {...props} aria-hidden="true" className={`${styles.strip} ${className ?? ""}`}>
      <span className={styles.track}>
        {Array.from({ length: capacity }, (_, index) => (
          <span
            key={index}
            className={styles.cell}
            data-state={index < empty ? "empty" : recent[index - empty]}
            data-optional={
              index < capacity - COMPACT_CELLS
                ? "compact"
                : index < capacity - TIGHT_CELLS
                  ? "tight"
                  : undefined
            }
          />
        ))}
      </span>
    </span>
  );
}

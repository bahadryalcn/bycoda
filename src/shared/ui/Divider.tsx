import type { ComponentPropsWithRef } from "react";
import styles from "./Divider.module.css";

export type DividerProps = Omit<ComponentPropsWithRef<"div">, "children"> & {
  /** `horizontal` (default) separates stacked content; `vertical` separates items in a row. */
  orientation?: "horizontal" | "vertical";
  /** Pull the line in from the ends: sm 8px / md 12px horizontally, 4px / 8px vertically. */
  inset?: false | "sm" | "md";
  /** Short caption centred on (or, with `labelAlign="start"`, near the start of) a horizontal line. */
  label?: string;
  labelAlign?: "center" | "start";
  /** Purely visual: hidden from assistive tech instead of `role="separator"`. */
  decorative?: boolean;
};

/**
 * Hairline separator in the pane border role (`--ui-pane-border`), horizontal or vertical,
 * with optional inset and a short centred or start-aligned caption. Exposes `role="separator"`
 * unless `decorative`.
 * @group layout
 * @use A rule between stacked sections or between items in a row, with or without a caption ("Earlier").
 * @avoid Group heading over a list: SectionLabel. Boxed grouping: a bordered container, not nested frames. Never a local border-t spacer div. A group with its own static frame: Surface.
 *
 * @example
 * <Divider />
 * <Divider orientation="vertical" inset="sm" decorative />
 * <Divider label={t("Earlier")} />
 */
export function Divider({
  orientation = "horizontal",
  inset = false,
  label,
  labelAlign = "center",
  decorative = false,
  className,
  ...props
}: DividerProps) {
  const labelled = !!label && orientation === "horizontal";
  return (
    <div
      {...props}
      role={decorative ? "none" : "separator"}
      aria-hidden={decorative || undefined}
      aria-orientation={decorative ? undefined : orientation}
      aria-label={decorative ? undefined : (props["aria-label"] ?? label)}
      data-orientation={orientation}
      data-inset={inset || undefined}
      data-labelled={labelled || undefined}
      data-label-align={labelled ? labelAlign : undefined}
      className={[styles.divider, className].filter(Boolean).join(" ")}
    >
      {labelled ? (
        <span className={styles.label} aria-hidden="true">
          {label}
        </span>
      ) : null}
    </div>
  );
}

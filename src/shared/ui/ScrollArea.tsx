import type { ComponentPropsWithRef } from "react";
import styles from "./ScrollArea.module.css";

export type ScrollAreaProps = ComponentPropsWithRef<"div"> & {
  /** Scroll direction: `y` (default), `x` for a horizontal strip, `both` for a free canvas. */
  axis?: "y" | "x" | "both";
  /**
   * `auto` (default) shows the shared scrollbar family set in Appearance; `hidden` keeps the
   * content scrollable without a bar (tab strips, chip rows).
   */
  scrollbar?: "auto" | "hidden";
  /** `stable` reserves the bar's space so content does not shift when the bar appears. */
  gutter?: "auto" | "stable";
};

/**
 * A scrolling region: the overflow axis, the scrollbar and its gutter come from props, so no
 * feature writes `scrollbar-*` or `::-webkit-scrollbar`. The bar itself is the one shared family
 * that Appearance settings size and colour. `className` is for placement and size (flex, height).
 *
 * Required only where the scrollbar itself is touched (hidden bar, stable gutter). A plain
 * `overflow: auto` is layout and stays in the feature: do not migrate it.
 * @group layout
 * @use A scrolling list, panel body or strip whose scrollbar is hidden or needs a stable gutter.
 * @avoid The body of a Modal, Sheet or Popover: they scroll themselves. A virtualized list: ContinuousList. A region that only needs overflow: keep the overflow class in the feature.
 * @example
 * <ScrollArea className="min-h-0 flex-1">{rows}</ScrollArea>
 * <ScrollArea axis="x" scrollbar="hidden">{tabs}</ScrollArea>
 * <ScrollArea gutter="stable">{settings}</ScrollArea>
 */
export function ScrollArea({
  axis = "y",
  scrollbar = "auto",
  gutter = "auto",
  className,
  ...props
}: ScrollAreaProps) {
  return (
    <div
      {...props}
      data-axis={axis}
      data-scrollbar={scrollbar === "hidden" ? "hidden" : undefined}
      data-gutter={gutter === "stable" ? "stable" : undefined}
      className={[styles.area, className].filter(Boolean).join(" ")}
    />
  );
}

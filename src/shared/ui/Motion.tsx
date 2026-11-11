import type { ComponentPropsWithRef } from "react";
import styles from "./Motion.module.css";

export type MotionProps = ComponentPropsWithRef<"div"> & {
  /** Element: `div` (default) or `span` for inline content. */
  as?: "div" | "span";
  /**
   * What eases when the caller changes it: `transform` (default; rotate, scale, translate),
   * `opacity`, or `colors` (text, fill, border and outline colours).
   */
  transition?: "transform" | "opacity" | "colors";
  /** `fast` (120ms, default) for feedback; `standard` (160ms) for a larger move. */
  duration?: "fast" | "standard";
  /** `rise` fades the element in while it settles 2px up, once, when it mounts. */
  enter?: "rise";
};

/**
 * Motion on an element: the property that eases, its duration and the mount animation come from
 * props and the shared motion tokens, so no feature writes `transition` or `animation`. It never
 * moves under reduced motion. `className` is for placement and for the state the caller changes
 * (rotate, opacity, translate).
 *
 * Motion is an element of its own. Wrapping a child of a flex or grid container puts a new box
 * between them, so the `flex`, `grid-area`, `min-width` and alignment classes of the child must
 * move to the Motion element. Do not migrate a transition before checking that the layout is
 * unchanged.
 * @group layout
 * @use A chevron that turns, a part that fades or slides when state changes, a notice that rises in.
 * @avoid A control's own hover and press: Button, ActionHost. Waiting: Spinner, LoadingText, Skeleton, WorkingIndicator. Overlays: Popover, Modal, Sheet animate themselves.
 * @example
 * <Motion as="span" className={open ? "rotate-90" : undefined}><ChevronRight /></Motion>
 * <Motion transition="opacity" className={visible ? undefined : "opacity-0"}>{hint}</Motion>
 * <Motion enter="rise" duration="standard">{notice}</Motion>
 */
export function Motion({
  as = "div",
  transition = "transform",
  duration = "fast",
  enter,
  className,
  ...props
}: MotionProps) {
  // One prop type for both tags: they take the same attributes.
  const Tag = as as "div";
  return (
    <Tag
      {...props}
      data-transition={transition}
      data-duration={duration === "standard" ? "standard" : undefined}
      data-enter={enter}
      className={[styles.motion, className].filter(Boolean).join(" ")}
    />
  );
}

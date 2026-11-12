import type { ComponentPropsWithRef } from "react";
import styles from "./Motion.module.css";

export type MotionRoles = {
  /**
   * What eases when the caller changes it: `transform` (default; rotate, scale, translate),
   * `opacity`, `colors` (text, fill, border and outline colours), `size` (width, height and
   * their limits) or `all` when several of these change together.
   */
  transition?: "transform" | "opacity" | "colors" | "size" | "all";
  /**
   * A duration token: `instant` 80ms, `fast` 120ms (default, feedback), `standard` 160ms (a
   * larger move), `slow` 260ms, `reveal` 320ms, `ambient` 600ms, `celebrate` 1100ms, `scene`
   * 2200ms. A hand-written duration moves to the nearest token.
   */
  duration?:
    | "instant"
    | "fast"
    | "standard"
    | "slow"
    | "reveal"
    | "ambient"
    | "celebrate"
    | "scene";
  /** An easing token; `linear` keeps a constant speed. Unset is the standard curve. */
  easing?: "standard" | "enter" | "exit" | "overshoot" | "rise" | "emphasized" | "sheen" | "linear";
  /**
   * Plays once when the element mounts: `rise` fades in while settling 2px up; `left`, `right`
   * and `down` slide in from that side; `scale` grows in.
   */
  enter?: "rise" | "left" | "right" | "down" | "scale";
};

export type MotionProps = ComponentPropsWithRef<"div"> &
  MotionRoles & {
    /** Element: `div` (default) or `span` for inline content. */
    as?: "div" | "span";
  };

/**
 * The attributes that give an existing element the shared motion roles, so it eases without a
 * new layout box: spread them on the element (an SVG part, a list item, a shared component that
 * forwards attributes). The state the caller changes stays a class or attribute of that element.
 */
export function motionAttributes(
  { transition = "transform", duration = "fast", easing, enter }: MotionRoles = {},
  className?: string,
) {
  return {
    "data-transition": transition,
    "data-duration": duration === "fast" ? undefined : duration,
    "data-easing": easing,
    "data-enter": enter,
    className: [styles.motion, className].filter(Boolean).join(" "),
  };
}

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
  easing,
  enter,
  className,
  ...props
}: MotionProps) {
  // One prop type for both tags: they take the same attributes.
  const Tag = as as "div";
  return (
    <Tag {...props} {...motionAttributes({ transition, duration, easing, enter }, className)} />
  );
}

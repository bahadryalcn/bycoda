import { useId, type ComponentPropsWithRef } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "./arc/lib/motion-tokens";
import styles from "./ButtonGroup.module.css";

/**
 * Joined action surface with shared hover/press. Children stay ordinary Buttons with their own hit target, focus, tooltip and busy/disabled state; `aria-label` names the group. `surface="navigation"` for navigation bars; `surface="transparent"` for ghost actions without an outer fill or border.
 * `selection="plate"` drops the dividers between segments and lets one `ButtonGroupSelection`, rendered inside the selected Button, glide between them.
 * This is the one grouped-actions component; ExpandingButtonGroup and FloatingButtonGroup are deprecated toward it.
 * @group actions
 * @use A few related actions that read as one control (footer update/GitHub buttons, toolbar clusters).
 * @avoid Choosing one of several options: SegmentedControl. Primary action with a menu: SplitButton. Independent actions: separate Buttons.
 */
export function ButtonGroup({
  className,
  children,
  surface = "default",
  selection = "segment",
  ...props
}: ComponentPropsWithRef<"div"> & {
  "aria-label": string;
  surface?: "default" | "navigation" | "transparent";
  /** `segment`: each selected Button fills its own divided segment. `plate`: no dividers,
   *  the selected Button renders a `ButtonGroupSelection` that glides between segments. */
  selection?: "segment" | "plate";
}) {
  // Scopes the plate's shared layout id, so two groups never trade plates.
  const layoutScope = useId();
  return (
    <div
      role="group"
      {...props}
      data-button-group="joined"
      data-surface={surface}
      data-selection={selection === "plate" ? "plate" : undefined}
      className={[styles.group, className].filter(Boolean).join(" ")}
    >
      {selection === "plate" ? <LayoutGroup id={layoutScope}>{children}</LayoutGroup> : children}
    </div>
  );
}

/**
 * The gliding selected plate of a `ButtonGroup selection="plate"`. Render it as a child of
 * the selected Button only; it is decorative and follows the selection between segments.
 * @group actions
 * @status internal
 */
export function ButtonGroupSelection() {
  const reduced = useReducedMotion();
  return (
    <motion.span
      aria-hidden="true"
      data-button-group-selection=""
      className={styles.selection}
      layoutId="selection"
      transition={reduced ? { duration: 0 } : motionTokens.spring.morph}
    />
  );
}

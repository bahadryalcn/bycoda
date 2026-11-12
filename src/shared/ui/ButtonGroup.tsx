import { useId, type ComponentPropsWithRef } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "./arc/lib/motion-tokens";
import styles from "./ButtonGroup.module.css";
import {
  ExpandingButtonGroup as ArcExpandingButtonGroup,
  type ExpandingButtonGroupProps,
} from "./arc/expanding-button-group/expanding-button-group";

export type {
  ExpandingButtonGroupItem,
  ExpandingButtonGroupTriggerProps,
} from "./arc/expanding-button-group/expanding-button-group";

type JoinedButtonGroupProps = ComponentPropsWithRef<"div"> & {
  variant?: "joined";
  "aria-label": string;
  surface?: "default" | "navigation" | "transparent";
  /** Per-segment state, or a gliding ButtonGroupSelection inside the selected Button. */
  selection?: "segment" | "plate";
};
export type ButtonGroupProps =
  | JoinedButtonGroupProps
  | (ExpandingButtonGroupProps & { variant: "expanding" });

/**
 * Joined action surface with shared hover/press. Children stay ordinary Buttons with their own hit target, focus, tooltip and busy/disabled state; `aria-label` names the group. `surface="navigation"` for navigation bars; `surface="transparent"` for ghost actions without an outer fill or border.
 * `selection="plate"` drops the dividers between segments and lets one `ButtonGroupSelection`, rendered inside the selected Button, glide between them.
 * `variant="expanding"` reveals command labels on intent through the existing Arc renderer.
 * FloatingButtonGroup owns a contextual toolbar's roving focus and transient action feedback.
 * @group actions
 * @use A few related commands that read as one control. Default joins visible Buttons; variant="expanding" reveals labels in compact command rails.
 * @avoid Choosing one of several options: SegmentedControl. Primary action with a menu: SplitButton. Independent actions: separate Buttons.
 * @arc expanding-button-group
 */
export function ButtonGroup(props: ButtonGroupProps) {
  if (props.variant === "expanding") {
    const { variant: _variant, ...expanding } = props;
    return (
      <ArcExpandingButtonGroup
        {...expanding}
        className={["bycoda-arc", expanding.className].filter(Boolean).join(" ")}
      />
    );
  }
  const { variant: _variant, ...joined } = props;
  return <JoinedButtonGroup {...joined} />;
}

function JoinedButtonGroup({
  className,
  children,
  surface = "default",
  selection = "segment",
  ...props
}: Omit<JoinedButtonGroupProps, "variant">) {
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
 * @use Render inside the selected Button of ButtonGroup selection="plate".
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

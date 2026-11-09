import type { ComponentPropsWithRef } from "react";
import styles from "./ButtonGroup.module.css";

/**
 * Joined action surface with shared hover/press. Children stay ordinary Buttons with their own hit target, focus, tooltip and busy/disabled state; `aria-label` names the group. `surface="navigation"` for navigation bars.
 * This is the one grouped-actions component; ExpandingButtonGroup and FloatingButtonGroup are deprecated toward it.
 * @group actions
 * @use A few related actions that read as one control (footer update/GitHub buttons, toolbar clusters).
 * @avoid Choosing one of several options: SegmentedControl. Primary action with a menu: SplitButton. Independent actions: separate Buttons.
 */
export function ButtonGroup({
  className,
  children,
  surface = "default",
  ...props
}: ComponentPropsWithRef<"div"> & { "aria-label": string; surface?: "default" | "navigation" }) {
  return (
    <div
      role="group"
      {...props}
      data-button-group="joined"
      data-surface={surface}
      className={[styles.group, className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

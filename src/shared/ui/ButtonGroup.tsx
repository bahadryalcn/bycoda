import type { ComponentPropsWithRef } from "react";
import styles from "./ButtonGroup.module.css";

/** Joined action surface. Children remain ordinary Buttons with independent focus and actions. */
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

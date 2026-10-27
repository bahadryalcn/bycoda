import type { ComponentPropsWithRef } from "react";
import styles from "./ButtonGroup.module.css";

/** Joined action surface. Children remain ordinary Buttons with independent focus and actions. */
export function ButtonGroup({
  className,
  children,
  ...props
}: ComponentPropsWithRef<"div"> & { "aria-label": string }) {
  return (
    <div
      role="group"
      {...props}
      data-button-group="joined"
      className={[styles.group, className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

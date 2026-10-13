import type { ComponentPropsWithRef } from "react";
import { Button as ArcButton, type ButtonSize, type ButtonVariant } from "./arc/button/button";
import styles from "./arc/button/button.module.css";

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

/** Native form/ref semantics with the compact bycoda Arc theme. */
export function Button({
  variant = "secondary",
  size = "sm",
  type = "button",
  loading = false,
  className,
  onDrag,
  onDragStart,
  onDragEnd,
  onAnimationStart,
  ...props
}: ButtonProps) {
  const themed = ["bycoda-arc", className].filter(Boolean).join(" ");
  // Motion reserves native drag/animation event names for gestures. Keep native
  // behavior for these handlers instead of silently reinterpreting them.
  if (onDrag || onDragStart || onDragEnd || onAnimationStart) {
    return (
      <button
        {...props}
        type={type}
        className={[styles.button, styles[variant], styles[size], themed].join(" ")}
        onDrag={onDrag}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onAnimationStart={onAnimationStart}
        aria-busy={loading || undefined}
        aria-disabled={loading || props["aria-disabled"] || undefined}
        onClick={loading ? (event) => event.preventDefault() : props.onClick}
      />
    );
  }
  return (
    <ArcButton
      {...props}
      type={type}
      variant={variant}
      size={size}
      loading={loading}
      className={themed}
    />
  );
}

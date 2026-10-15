import type { ComponentPropsWithRef, KeyboardEvent, ReactNode, SyntheticEvent } from "react";
import {
  Button as ArcButton,
  type ButtonSize,
  type ButtonVariant as ArcButtonVariant,
} from "./arc/button/button";
import arcStyles from "./arc/button/button.module.css";
import styles from "./Button.module.css";

export type { ButtonSize } from "./arc/button/button";
export type ButtonVariant = ArcButtonVariant | "link" | "item" | "tab";
export type ButtonShape = "default" | "pill";

type CommonButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  /** Visual selection only. The owning interaction supplies its appropriate ARIA state. */
  selected?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  tooltip?: string;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  fullWidth?: boolean;
  /** Disable label/press motion for controls that require a stable, direct DOM layout. */
  motion?: "auto" | "none";
};

export type ButtonProps = CommonButtonProps &
  ({ iconOnly: true; label: string } | { iconOnly?: false; label?: string });

const isTrue = (value: unknown) => value === true || value === "true";

/** One application API, with Arc action rendering and native structural/event rendering. */
export function Button({
  variant = "secondary",
  size = "sm",
  shape = "default",
  type = "button",
  selected,
  loading = false,
  loadingLabel,
  iconOnly = false,
  label,
  tooltip,
  startIcon,
  endIcon,
  fullWidth = false,
  motion = "auto",
  className,
  children,
  disabled,
  onClick,
  onClickCapture,
  onPointerDown,
  onPointerDownCapture,
  onMouseDown,
  onKeyDown,
  onKeyDownCapture,
  onDrag,
  onDragStart,
  onDragEnd,
  onAnimationStart,
  ...props
}: ButtonProps) {
  const structural = variant === "item" || variant === "tab";
  const native =
    structural ||
    variant === "link" ||
    motion === "none" ||
    !!(
      props.draggable ||
      onDrag ||
      onDragStart ||
      onDragEnd ||
      onAnimationStart ||
      props.onDragEnter ||
      props.onDragLeave ||
      props.onDragOver ||
      props.onDrop
    );
  const blocked = !!disabled || loading || isTrue(props["aria-disabled"]);
  const active =
    selected ??
    (isTrue(props["aria-selected"]) ||
      isTrue(props["aria-pressed"]) ||
      isTrue(props["aria-checked"]));
  const arcVariant: ArcButtonVariant = variant === "link" || structural ? "ghost" : variant;
  const classes = [
    "bycoda-arc",
    styles.control,
    styles[variant],
    iconOnly ? styles.iconOnly : "",
    fullWidth ? styles.fullWidth : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const guard =
    <E extends SyntheticEvent>(handler?: (event: E) => void) =>
    (event: E) => {
      if (blocked) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      handler?.(event);
    };
  const guardKey = (handler: typeof onKeyDown) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (blocked && (event.key === "Enter" || event.key === " " || event.key === "Spacebar")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    handler?.(event);
  };
  const attributes = {
    ...props,
    type,
    disabled,
    title: props.title ?? tooltip ?? (iconOnly ? label : undefined),
    "aria-label": loading && loadingLabel ? loadingLabel : (props["aria-label"] ?? label),
    "aria-busy": loading || props["aria-busy"] || undefined,
    "aria-disabled": blocked || props["aria-disabled"] || undefined,
    "data-button-variant": variant,
    "data-button-shape": shape,
    "data-button-selected": active || undefined,
    "data-button-loading": loading || undefined,
    "data-button-structural": structural || undefined,
    "data-button-size": size,
    onClick: guard(onClick),
    onClickCapture: guard(onClickCapture),
    onPointerDown: guard(onPointerDown),
    onPointerDownCapture: guard(onPointerDownCapture),
    onMouseDown: guard(onMouseDown),
    onKeyDown: guardKey(onKeyDown),
    onKeyDownCapture: guardKey(onKeyDownCapture),
    onKeyUp: guardKey(props.onKeyUp),
    onDoubleClick: guard(props.onDoubleClick),
    onContextMenu: guard(props.onContextMenu),
    onDragEnter: guard(props.onDragEnter),
    onDragLeave: props.onDragLeave,
    onDragOver: guard(props.onDragOver),
    onDrop: guard(props.onDrop),
  };
  const content = (
    <>
      {startIcon != null ? (
        <span className={styles.icon} aria-hidden="true">
          {startIcon}
        </span>
      ) : null}
      {children}
      {endIcon != null ? (
        <span className={styles.icon} aria-hidden="true">
          {endIcon}
        </span>
      ) : null}
    </>
  );
  if (native) {
    return (
      <button
        {...attributes}
        className={[arcStyles.button, arcStyles[arcVariant], arcStyles[size], classes].join(" ")}
        onDrag={guard(onDrag)}
        onDragStart={guard(onDragStart)}
        onDragEnd={onDragEnd}
        onAnimationStart={onAnimationStart}
        draggable={blocked ? false : props.draggable}
      >
        {structural ? (
          content
        ) : (
          <span
            className={[
              arcStyles.labelSlot,
              styles.nativeContent,
              loading ? arcStyles.loadingLabel : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {content}
          </span>
        )}
        {loading ? (
          <span
            className={structural ? styles.structuralLoader : arcStyles.loader}
            aria-hidden="true"
          >
            <span className={arcStyles.spinner} />
          </span>
        ) : null}
      </button>
    );
  }
  return (
    <ArcButton
      {...attributes}
      variant={arcVariant}
      size={size}
      loading={loading}
      className={classes}
    >
      {content}
    </ArcButton>
  );
}

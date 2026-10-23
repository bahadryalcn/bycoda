import {
  useId,
  useState,
  type ComponentPropsWithRef,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { Popover } from "./Popover";
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
export type ButtonTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

type CommonButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  /** Semantic intent, independent of hierarchy. `error` is a legacy danger alias. */
  tone?: ButtonTone | "error";
  size?: ButtonSize;
  shape?: ButtonShape;
  /** Visual selection only. The owning interaction supplies its appropriate ARIA state. */
  selected?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  tooltip?: string;
  /** Display only: the owner resolves the current binding and handles the keys. */
  shortcut?: string | null;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  fullWidth?: boolean;
  /** Disable label/press motion for controls that require a stable, direct DOM layout. */
  motion?: "auto" | "none";
  /** Content alignment inside a wide control. Default `center`; use `start`/`end` instead of `text-left` or `justify-*` overrides. */
  align?: "center" | "start" | "end";
  /** Structural item/tab content may form a record row instead of an inline action. */
  layout?: "inline" | "stacked" | "text" | "media";
};

export type ButtonProps = CommonButtonProps &
  ({ iconOnly: true; label: string } | { iconOnly?: false; label?: string });

/** Shared native presentation for DOM-owned composites such as CodeMirror panels. */
export function nativeButtonPresentation({
  variant = "ghost",
  size = "sm",
  iconOnly = false,
}: { variant?: "ghost" | "secondary"; size?: ButtonSize; iconOnly?: boolean } = {}) {
  return {
    className: [
      arcStyles.button,
      arcStyles[variant],
      arcStyles[size],
      "bycoda-arc",
      styles.control,
      styles[variant],
      iconOnly ? styles.iconOnly : "",
    ]
      .filter(Boolean)
      .join(" "),
    "data-button-variant": variant,
    "data-button-hierarchy": variant,
    "data-button-tone": "neutral",
    "data-button-size": size,
  };
}

const isTrue = (value: unknown) => value === true || value === "true";

/** One application API, with Arc action rendering and native structural/event rendering. */
export function Button({
  variant = "secondary",
  tone,
  size = "sm",
  shape = "default",
  type = "button",
  selected,
  loading = false,
  loadingLabel,
  iconOnly = false,
  label,
  tooltip,
  shortcut,
  startIcon,
  endIcon,
  fullWidth = false,
  motion = "auto",
  layout,
  align,
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
  const hintId = useId();
  const [hintAnchor, setHintAnchor] = useState<HTMLButtonElement | null>(null);
  // Keep legacy aliases at this boundary; render one hierarchy/tone implementation.
  const hierarchy = variant === "danger" ? "secondary" : variant;
  const resolvedTone: ButtonTone =
    tone === "error" ? "danger" : (tone ?? (variant === "danger" ? "danger" : "neutral"));
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
      isTrue(props["aria-checked"]) ||
      isTrue(props["aria-current"]) ||
      props["aria-current"] === "page");
  const arcVariant: ArcButtonVariant =
    hierarchy === "link" || hierarchy === "item" || hierarchy === "tab" ? "ghost" : hierarchy;
  const classes = [
    "bycoda-arc",
    styles.control,
    styles[hierarchy],
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
    if (event.key === "Escape") setHintAnchor(null);
    if (blocked && (event.key === "Enter" || event.key === " " || event.key === "Spacebar")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    handler?.(event);
  };
  const tooltipText = props.title ?? tooltip ?? (iconOnly || shortcut ? label : undefined);
  const hintText = shortcut && tooltipText ? `${tooltipText} (${shortcut})` : tooltipText;
  const hintVisible = !!hintAnchor && !!hintText;
  const attributes = {
    ...props,
    type,
    disabled,
    title: hintText,
    "aria-describedby":
      [props["aria-describedby"], hintVisible ? hintId : undefined].filter(Boolean).join(" ") ||
      undefined,
    "aria-label": loading && loadingLabel ? loadingLabel : (props["aria-label"] ?? label),
    "aria-busy": loading || props["aria-busy"] || undefined,
    "aria-disabled": blocked || props["aria-disabled"] || undefined,
    "data-button-variant": variant,
    "data-button-hierarchy": hierarchy,
    "data-button-tone": resolvedTone,
    "data-button-shape": shape,
    "data-button-selected": active || undefined,
    "data-button-loading": loading || undefined,
    "data-button-structural": structural || undefined,
    "data-button-layout":
      structural || variant === "link" || layout === "media" ? layout : undefined,
    "data-button-size": size,
    "data-button-align": align && align !== "center" ? align : undefined,
    // Controls that do not scale on press (native renderer, popup anchors) step their tone instead.
    "data-button-press": native ? "tone" : undefined,
    onClick: guard((event: MouseEvent<HTMLButtonElement>) => {
      setHintAnchor(null);
      onClick?.(event);
    }),
    onClickCapture: guard(onClickCapture),
    onPointerDown: guard((event: PointerEvent<HTMLButtonElement>) => {
      setHintAnchor(null);
      onPointerDown?.(event);
    }),
    onFocus: (event: FocusEvent<HTMLButtonElement>) => {
      props.onFocus?.(event);
      if (
        !event.defaultPrevented &&
        (iconOnly || shortcut || tooltip) &&
        hintText &&
        event.currentTarget.matches(":focus-visible")
      )
        setHintAnchor(event.currentTarget);
    },
    onBlur: (event: FocusEvent<HTMLButtonElement>) => {
      setHintAnchor(null);
      props.onBlur?.(event);
    },
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
  const withHint = (control: ReactNode) => (
    <>
      {control}
      {hintVisible ? (
        <Popover
          anchor={hintAnchor}
          role="tooltip"
          id={hintId}
          side="bottom"
          restoreFocus={false}
          passive
          onDismiss={() => setHintAnchor(null)}
          className="pointer-events-none max-w-60 break-words p-2 text-(length:--ui-font-caption) text-content"
        >
          {hintText}
        </Popover>
      ) : null}
    </>
  );
  if (native) {
    return withHint(
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
      </button>,
    );
  }
  return withHint(
    <ArcButton
      {...attributes}
      variant={arcVariant}
      size={size}
      loading={loading}
      className={classes}
    >
      {content}
    </ArcButton>,
  );
}

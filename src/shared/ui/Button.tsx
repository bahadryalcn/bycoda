import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
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
  /** Retain the widest measured text label across async state changes. Defaults on with loading. */
  stableWidth?: boolean;
  /** Other text labels this button will show (pending, retry, done). Their widths are reserved
   *  up front by invisible ghosts that add no DOM text, so the control never grows when its
   *  label changes. The current label stays the only text content and accessible name. */
  reserveLabels?: readonly string[];
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
  /** Compact icon action inside a row, tab or card that owns the highlight
   *  (`ActionHost`): about 20px, transparent overlay hover/press, secondary ink.
   *  Prefer `InlineAction`, which also handles reveal and event isolation. */
  inset?: boolean | "icon" | "text";
  /** Toggle state: sets `aria-pressed` and the selected look. Use for on/off tools;
   *  `selected` stays visual only. An explicit `aria-pressed` still wins. */
  pressed?: boolean;
  /** Fires once when the primary pointer stays down for `longPressDelay` ms (touch and
   *  mouse). The click that follows that press is suppressed. Keyboard and the plain
   *  click are unchanged, so the long-press action needs an equivalent menu or shortcut. */
  onLongPress?: (event: PointerEvent<HTMLButtonElement>) => void;
  /** Hold time for `onLongPress` in milliseconds. Default 500. */
  longPressDelay?: number;
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
  loading: loadingProp,
  loadingLabel,
  stableWidth,
  reserveLabels,
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
  inset = false,
  pressed,
  onLongPress,
  longPressDelay = 500,
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
  const loading = loadingProp ?? false;
  const labelMeasure = useRef<HTMLSpanElement>(null);
  const [labelWidth, setLabelWidth] = useState(0);
  const reserveLabel = stableWidth ?? (loadingProp !== undefined || !!reserveLabels?.length);
  // The current label is always the rendered (and accessible) text. Width stays stable by
  // retaining the widest measured label, so idle/pending/retry texts never shrink the control.
  useLayoutEffect(() => {
    const node = labelMeasure.current;
    if (!reserveLabel || !node) return;
    const measure = () => {
      const width = node.getBoundingClientRect().width;
      setLabelWidth((previous) => Math.max(previous, width));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children, reserveLabel]);
  const longPress = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const clearLongPress = () => {
    const current = longPress.current;
    if (current) window.clearTimeout(current.timer);
    return current;
  };
  useEffect(() => () => void clearLongPress(), []);
  const insetText = inset === "text";
  const hintId = useId();
  const [hintAnchor, setHintAnchor] = useState<HTMLButtonElement | null>(null);
  // Keep legacy aliases at this boundary; render one hierarchy/tone implementation.
  const hierarchy = variant === "danger" ? "secondary" : variant;
  const resolvedTone: ButtonTone =
    tone === "error" ? "danger" : (tone ?? (variant === "danger" ? "danger" : "neutral"));
  const structural = variant === "item" || variant === "tab";
  // A text action with a start icon swaps that icon for the spinner in the same slot.
  // Without an icon nothing is reserved at rest (no empty gap); while pending, the
  // label keeps its width and accessible name under a centered spinner instead.
  const inlineProgress =
    loadingProp !== undefined &&
    startIcon != null &&
    !iconOnly &&
    !structural &&
    layout !== "media";
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
    (pressed ??
      (isTrue(props["aria-selected"]) ||
      isTrue(props["aria-pressed"]) ||
      isTrue(props["aria-checked"]) ||
      isTrue(props["aria-current"]) ||
      props["aria-current"] === "page"));
  const arcVariant: ArcButtonVariant =
    hierarchy === "link" || hierarchy === "item" || hierarchy === "tab" ? "ghost" : hierarchy;
  const classes = [
    "bycoda-arc",
    styles.control,
    styles[hierarchy],
    iconOnly ? styles.iconOnly : "",
    inset ? styles.inset : "",
    insetText ? styles.insetText : "",
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
    // Pending is already guarded and aria-disabled. Keep the initiating control
    // focusable even when its owner also passes disabled={pending}.
    disabled: loading ? undefined : disabled,
    title: hintText,
    "aria-describedby":
      [props["aria-describedby"], hintVisible ? hintId : undefined].filter(Boolean).join(" ") ||
      undefined,
    "aria-label": loading && loadingLabel ? loadingLabel : (props["aria-label"] ?? label),
    "aria-busy": loading || props["aria-busy"] || undefined,
    "aria-pressed": props["aria-pressed"] ?? pressed,
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
    // Any explicit alignment is authoritative over structural (item/tab) defaults.
    "data-button-align": align,
    // Controls that do not scale on press (native renderer, popup anchors) step their tone instead.
    "data-button-press": native ? "tone" : undefined,
    onClick: guard((event: MouseEvent<HTMLButtonElement>) => {
      setHintAnchor(null);
      onClick?.(event);
    }),
    onClickCapture: guard((event: MouseEvent<HTMLButtonElement>) => {
      // The press that already ran its long-press action must not also activate.
      if (longPress.current?.fired) {
        longPress.current = null;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onClickCapture?.(event);
    }),
    onPointerDown: guard((event: PointerEvent<HTMLButtonElement>) => {
      setHintAnchor(null);
      clearLongPress();
      longPress.current = null;
      if (onLongPress && event.isPrimary && event.button === 0) {
        const target = event;
        const state = {
          timer: 0,
          x: event.clientX,
          y: event.clientY,
          fired: false,
        };
        state.timer = window.setTimeout(() => {
          state.fired = true;
          onLongPress(target);
        }, longPressDelay);
        longPress.current = state;
      }
      onPointerDown?.(event);
    }),
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const current = longPress.current;
      if (
        current &&
        !current.fired &&
        Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8
      ) {
        window.clearTimeout(current.timer);
        longPress.current = null;
      }
      props.onPointerMove?.(event);
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      const current = longPress.current;
      if (current && !current.fired) {
        window.clearTimeout(current.timer);
        longPress.current = null;
      } else if (current) {
        // Keep the fired mark just long enough to swallow the click that follows.
        window.setTimeout(() => {
          if (longPress.current === current) longPress.current = null;
        }, 100);
      }
      props.onPointerUp?.(event);
    },
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
      clearLongPress();
      longPress.current = null;
      props.onPointerCancel?.(event);
    },
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
    onContextMenu: guard((event: MouseEvent<HTMLButtonElement>) => {
      // Touch long-press raises the context menu; the long-press action replaces it.
      if (longPress.current?.fired) {
        event.preventDefault();
        return;
      }
      props.onContextMenu?.(event);
    }),
    onDragEnter: guard(props.onDragEnter),
    onDragLeave: props.onDragLeave,
    onDragOver: guard(props.onDragOver),
    onDrop: guard(props.onDrop),
  };
  const content = (
    <>
      {inlineProgress ? (
        <span
          className={styles.progressIcon}
          data-pending={loading || undefined}
          aria-hidden="true"
        >
          {startIcon != null ? <span className={styles.icon}>{startIcon}</span> : null}
          <span hidden={!loading} className={`${arcStyles.spinner} ${styles.progressSpinner}`} />
        </span>
      ) : startIcon != null ? (
        <span className={styles.icon} aria-hidden="true">
          {startIcon}
        </span>
      ) : null}
      {typeof children === "string" || typeof children === "number" ? (
        <span
          className={styles.label}
          data-label-reserved={reserveLabel || undefined}
          data-label-ghosts={reserveLabels?.length ? "" : undefined}
          style={reserveLabel ? { minInlineSize: labelWidth } : undefined}
        >
          <span ref={labelMeasure} className={styles.stableLabel}>{children}</span>
          {reserveLabels?.map((text, index) => (
            <span key={index} className={styles.labelGhost} data-reserve={text} aria-hidden="true" />
          ))}
        </span>
      ) : (
        children
      )}
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
          motion="none"
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
              loading && !inlineProgress ? arcStyles.loadingLabel : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {content}
          </span>
        )}
        {loading && !inlineProgress ? (
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
      loading={loading && !inlineProgress}
      className={classes}
    >
      {content}
    </ArcButton>,
  );
}

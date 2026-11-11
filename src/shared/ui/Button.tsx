import {
  useEffect,
  useLayoutEffect,
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
import type { PopoverAlign, PopoverSide } from "../lib/popover";
import { Check } from "./icons";
import { LiveText } from "./LiveText";
import { useTooltip } from "./Tooltip";
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
  /** Confirmed by the operation owner; clear when the draft or target changes. Pending wins. */
  success?: boolean;
  /** Translated completion label, shown and announced inside the action instead of a sibling notice. */
  successLabel?: string;
  /** Retain the widest measured text label across async state changes. Defaults on with loading. */
  stableWidth?: boolean;
  /** Other text labels this button will show (pending, retry, done). Their widths are reserved
   *  up front by invisible ghosts that add no DOM text, so the control never grows when its
   *  label changes. The current label stays the only text content and accessible name. */
  reserveLabels?: readonly string[];
  /** Translated hint shown in the shared Tooltip on hover and keyboard focus (never a native
   *  `title`). An explicit `title` takes precedence; `title=""` means no tooltip at all, for a
   *  Button that an outer `Tooltip` already describes. Icon-only buttons fall back to `label`. */
  tooltip?: string;
  /** Show repeated text only when clipped/hidden. Extra details and missing shortcuts stay available. */
  tooltipWhen?: "always" | "overflow";
  /** Muted lines under the tooltip title (path, counts, state). */
  tooltipDetails?: readonly ReactNode[];
  /** Tooltip placement. Default `bottom`. */
  tooltipSide?: PopoverSide;
  tooltipAlign?: PopoverAlign;
  /** Wider tooltip cap (`max-w-80`) for paths and long detail lines. */
  tooltipWide?: boolean;
  /** When the tooltip opens. `always` (default): pointer hover and keyboard focus. `focus`:
   *  keyboard focus only, for controls whose pointer users already see the same detail (a rail
   *  row showing its full text on hover elsewhere). Replaces a wrapping `<Tooltip>` that
   *  toggled itself off for pointers. */
  tooltipOn?: "always" | "focus";
  /** Display only, shown as key caps in the tooltip: the owner resolves the current binding
   *  (`useKeybindingShortcut`) and handles the keys. Accepts `Mod+K`, `Ctrl+Shift+P`, `⌘⇧P`,
   *  `Esc Esc` and `A / B` alternatives. */
  shortcut?: string | null;
  /** With `disabled`: keep the control focusable (`aria-disabled`, presses swallowed) and show
   *  this reason in its tooltip, so pointer and keyboard users both learn why it is off. */
  disabledReason?: string;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  /** Keep the start icon visible and reveal the text on hover/focus. Use with motion="none" in a bounded toolbar. */
  revealLabel?: boolean;
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
}: {
  variant?: "ghost" | "secondary";
  size?: ButtonSize;
  iconOnly?: boolean;
} = {}) {
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

/**
 * The one action control: variants `primary`, `secondary` (default), `ghost`, `link`, `item` and `tab`, with tone, size, icons, `loading` and `pressed` toggle state. It owns focus ring, hit area, tooltip (`tooltip`, `shortcut`, `disabledReason`), stable width across label changes and long-press.
 * Icon-only buttons need `iconOnly` and a `label`.
 * For confirmed async results, set `success` and translated `successLabel`; the action owns its check, label and announcement. Clear success when its draft or target changes.
 * @group actions
 * @use Any click that runs an action, opens something or navigates.
 * @avoid Choosing between modes: SegmentedControl or RadioGroup. Navigation to an external page: Button variant="link" with openExternal. Icon action inside a row/tab host: InlineAction. Joined related actions: ButtonGroup.
 */
export function Button({
  variant = "secondary",
  tone,
  size = "sm",
  shape = "default",
  type = "button",
  selected,
  loading: loadingProp,
  loadingLabel,
  success = false,
  successLabel,
  stableWidth,
  reserveLabels,
  iconOnly = false,
  label,
  tooltip,
  tooltipWhen = "always",
  tooltipDetails,
  tooltipSide = "bottom",
  tooltipAlign,
  tooltipWide,
  tooltipOn = "always",
  shortcut,
  disabledReason,
  startIcon,
  endIcon,
  revealLabel = false,
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
  const confirmed = success && !!successLabel && !loading;
  const contentLabel = confirmed ? successLabel : children;
  // Reserve the result icon from idle too, so completion never shifts neighbouring actions.
  const leadingIcon = confirmed ? (
    <Check className="icon-sm" />
  ) : (
    (startIcon ?? (successLabel ? <Check className="icon-sm invisible" /> : undefined))
  );
  const [announcerMounted, setAnnouncerMounted] = useState(false);
  if (confirmed && !announcerMounted) setAnnouncerMounted(true);
  const reservedLabels = successLabel ? [...(reserveLabels ?? []), successLabel] : reserveLabels;
  const labelMeasure = useRef<HTMLSpanElement>(null);
  const [labelWidth, setLabelWidth] = useState(0);
  const reserveLabel = stableWidth ?? (loadingProp !== undefined || !!reservedLabels?.length);
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
  }, [contentLabel, reserveLabel]);
  const longPress = useRef<{
    timer: number;
    x: number;
    y: number;
    fired: boolean;
  } | null>(null);
  const clearLongPress = () => {
    const current = longPress.current;
    if (current) window.clearTimeout(current.timer);
    return current;
  };
  useEffect(() => () => void clearLongPress(), []);
  const insetText = inset === "text";
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
    leadingIcon != null &&
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
  // A disabled control with a reason stays focusable so keyboard users reach the reason.
  const explained = !!disabled && !!disabledReason;
  const blocked = !!disabled || loading || isTrue(props["aria-disabled"]);
  const active =
    selected ??
    pressed ??
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
  // Tooltip: one shared hint for `title`, `tooltip`, the icon-only `label` and `shortcut`.
  // `title=""` is an explicit "no tooltip" (an outer Tooltip owns the hint).
  const suppressed = props.title === "";
  const tooltipText = suppressed
    ? undefined
    : props.title || tooltip || (iconOnly ? label : undefined);
  const reason = explained && !suppressed ? disabledReason : undefined;
  const hintLabel = tooltipText ?? reason;
  const hintDetails = suppressed
    ? undefined
    : reason && tooltipText
      ? [...(tooltipDetails ?? []), reason]
      : tooltipDetails;
  const hintShortcut = suppressed ? null : shortcut;
  const hint = useTooltip({
    when: reason ? "always" : tooltipWhen,
    label: hintLabel,
    details: hintDetails,
    shortcut: hintShortcut,
    side: tooltipSide,
    align: tooltipAlign,
    wide: tooltipWide,
    describe: false,
  });
  const accessibleName =
    loading && loadingLabel
      ? loadingLabel
      : confirmed
        ? successLabel
        : (props["aria-label"] ?? label);
  // Do not describe a control with a hint that only repeats its accessible name.
  const describes =
    hint.open && !(hintLabel === accessibleName && !hintShortcut && !hintDetails?.length);
  const guardKey = (handler: typeof onKeyDown) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") hint.hide();
    if (blocked && (event.key === "Enter" || event.key === " " || event.key === "Spacebar")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    handler?.(event);
  };
  const attributes = {
    ...props,
    "data-tooltip-owner": hintLabel || hintShortcut || hintDetails?.length ? "" : undefined,
    type,
    // Pending is already guarded and aria-disabled. Keep the initiating control
    // focusable even when its owner also passes disabled={pending}; the same holds for a
    // disabled control that explains why (`disabledReason`).
    disabled: loading || explained ? undefined : disabled,
    // Never the native OS bubble: the shared Tooltip shows this text.
    title: undefined,
    "aria-describedby":
      [props["aria-describedby"], describes ? hint.id : undefined].filter(Boolean).join(" ") ||
      undefined,
    // The reason stays announced while the hint is closed.
    "aria-description": props["aria-description"] ?? (reason && !describes ? reason : undefined),
    "aria-label": accessibleName,
    "aria-busy": loading || props["aria-busy"] || undefined,
    "aria-pressed": props["aria-pressed"] ?? pressed,
    "aria-disabled": blocked || props["aria-disabled"] || undefined,
    "data-disabled": explained || undefined,
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
    "data-button-reveal-label": revealLabel || undefined,
    // Any explicit alignment is authoritative over structural (item/tab) defaults.
    "data-button-align": align,
    // Controls that do not scale on press (native renderer, popup anchors) step their tone instead.
    "data-button-press": native ? "tone" : undefined,
    onClick: guard((event: MouseEvent<HTMLButtonElement>) => {
      hint.hide();
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
    onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => {
      props.onPointerEnter?.(event);
      if (tooltipOn !== "focus") hint.trigger.onPointerEnter(event);
    },
    onPointerLeave: (event: PointerEvent<HTMLButtonElement>) => {
      props.onPointerLeave?.(event);
      hint.trigger.onPointerLeave();
    },
    onPointerDown: guard((event: PointerEvent<HTMLButtonElement>) => {
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
      if (!event.defaultPrevented && event.target === event.currentTarget)
        hint.trigger.onFocus(event);
    },
    onBlur: (event: FocusEvent<HTMLButtonElement>) => {
      hint.hide();
      props.onBlur?.(event);
    },
    onPointerDownCapture: (event: PointerEvent<HTMLButtonElement>) => {
      // A press closes the hint even when the control is blocked and swallows the press.
      hint.hide();
      guard(onPointerDownCapture)(event);
    },
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
          {leadingIcon != null ? <span className={styles.icon}>{leadingIcon}</span> : null}
          <span hidden={!loading} className={`${arcStyles.spinner} ${styles.progressSpinner}`} />
        </span>
      ) : leadingIcon != null ? (
        <span className={styles.icon} aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      {typeof contentLabel === "string" || typeof contentLabel === "number" ? (
        <span
          className={styles.label}
          data-label-reserved={reserveLabel || undefined}
          data-label-ghosts={reservedLabels?.length ? "" : undefined}
          style={reserveLabel ? { minInlineSize: labelWidth } : undefined}
        >
          <span ref={labelMeasure} className={styles.stableLabel}>
            {contentLabel}
          </span>
          {reservedLabels?.map((text, index) => (
            <span
              key={index}
              className={styles.labelGhost}
              data-reserve={text}
              aria-hidden="true"
            />
          ))}
        </span>
      ) : (
        contentLabel
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
      {hint.tooltip}
      {announcerMounted ? (
        <LiveText text={confirmed ? successLabel! : ""} className="sr-only" />
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

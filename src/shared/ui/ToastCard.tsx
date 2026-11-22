import { useEffect, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import { useStableCallback } from "../hooks/useStableCallback";
import { useT } from "../i18n";
import { elapsedSince, monotonicNow } from "../lib/time/timestamps";
import { ToastStackCard, useToastStackItem } from "./arc/toast-stack/toast-stack";
import { Button } from "./Button";
import { X } from "./icons";
import { NoticeButton, type NoticeAction } from "./Notice";
import { Progress } from "./Progress";

export type ToastTone = "neutral" | "info" | "success" | "warning" | "danger";

/** The longest finite toast time: ten seconds of focused window time for an error without an action. */
export const TOAST_VISIBLE_MS = 10_000;

/**
 * Default visible time by tone: confirmations are short, a warning needs a longer read, an error
 * stays long enough to act on, and an error that offers an action never expires on its own.
 */
export function toastDurationMs(tone: ToastTone, hasAction: boolean): number | null {
  if (tone === "danger") return hasAction ? null : TOAST_VISIBLE_MS;
  if (tone === "warning") return 8_000;
  return 5_000;
}

/**
 * Expires after `durationMs` of visible, unattended time: hover, focus inside, `paused` and a
 * hidden document or unfocused window hold the timer and resume only the remaining time.
 * `null` never expires.
 */
export function useAutoDismiss(
  surface: { current: HTMLElement | null },
  {
    durationMs,
    paused,
    onExpire,
    resetKey,
  }: {
    durationMs: number | null;
    /** An operation that cannot be interrupted, or an open stack; the notice waits. */
    paused?: boolean;
    onExpire: () => void;
    /** A new message restarts the timer; parent rerenders do not. */
    resetKey?: unknown;
  },
) {
  const expire = useStableCallback(onExpire);
  const budget = useRef<{
    key: unknown;
    durationMs: number;
    left: number;
    hovered: boolean;
  } | null>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- runs the expiry timer and its hover, focus and window listeners
  useEffect(() => {
    const node = surface.current;
    if (!node || durationMs === null) {
      budget.current = null;
      return;
    }
    // A new message or duration restarts the countdown; a pause keeps what is left of it.
    const kept = budget.current;
    const current =
      kept && kept.key === resetKey && kept.durationMs === durationMs
        ? kept
        : { key: resetKey, durationMs, left: durationMs, hovered: kept?.hovered ?? false };
    budget.current = current;
    let started = 0;
    let timer: number | undefined;
    // The pointer state outlives a pause, which restarts this effect without a pointer event.
    if (!current.hovered) current.hovered = node.matches(":hover");
    let focused = node.contains(document.activeElement);
    let windowFocused = document.hasFocus();
    const pause = () => {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
      current.left = Math.max(0, current.left - elapsedSince(started));
    };
    const resume = () => {
      if (timer !== undefined || paused || current.hovered || focused) return;
      if (document.hidden || !windowFocused) return;
      started = monotonicNow();
      timer = window.setTimeout(() => {
        timer = undefined;
        expire();
      }, current.left);
    };
    const enter = () => {
      current.hovered = true;
      pause();
    };
    const leave = () => {
      current.hovered = false;
      resume();
    };
    const focus = () => {
      focused = true;
      pause();
    };
    const blur = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
      focused = false;
      resume();
    };
    const visibility = () => {
      windowFocused = document.hasFocus();
      if (document.hidden) pause();
      else resume();
    };
    const windowFocus = () => {
      windowFocused = true;
      resume();
    };
    const windowBlur = () => {
      windowFocused = false;
      pause();
    };
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointerleave", leave);
    node.addEventListener("focusin", focus);
    node.addEventListener("focusout", blur);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", windowFocus);
    window.addEventListener("blur", windowBlur);
    resume();
    return () => {
      pause();
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("focusin", focus);
      node.removeEventListener("focusout", blur);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", windowFocus);
      window.removeEventListener("blur", windowBlur);
    };
  }, [surface, durationMs, paused, resetKey, expire]);
}

export type ToastAction = NoticeAction;

export type ToastContentProps = {
  /** Primary text. With `title`, it is the body under the heading. */
  message?: ReactNode;
  title?: string;
  /** Tone drives the glyph, role and default duration (danger announces assertively); never colour alone. Required: choose it from the event, an error path is `danger`. */
  tone: ToastTone;
  /** How many times the same toast was shown while this one was visible; shown as "×N" from 2. */
  count?: number;
  /** Extra body, such as a list of rows. Rendered below the message. */
  children?: ReactNode;
  /** One secondary action (Undo, Retry, Open), at the end of the row. */
  action?: ToastAction;
  /** Additional structured actions under the message, such as "Update all" or Yes / Later / No. */
  actions?: NoticeAction[];
  /** Escape for one non-button control beside `actions` (an ErrorDetails trigger). */
  extra?: ReactNode;
  /**
   * Where `actions` sit. `"header"` (default) for actions about a list below, such as
   * "Update all"; `"footer"` for answers to a question the message asks (Yes / Later / No).
   */
  actionsPlacement?: "header" | "footer";
  /** Determinate progress from 0 to 1, with an accessible label. */
  progress?: { value: number; label: string };
  /** Omit for a toast the owner removes itself (no dismiss control, no expiry). */
  onDismiss?: () => void;
  /** Disables the dismiss control (and pauses expiry) while an operation cannot be interrupted. */
  dismissDisabled?: boolean;
  /**
   * Auto-dismiss delay; defaults by tone (info and success 5 s, warning 8 s, error 10 s, an
   * error with an action never expires). `null` explicitly keeps the toast until dismissed.
   */
  durationMs?: number | null;
  /** Width of a self-positioned card. A corner stack has one width for every toast. */
  width?: "md" | "lg";
  "aria-label"?: string;
};

const WIDTH = {
  md: "w-[min(340px,calc(100vw-24px))]",
  lg: "w-[min(360px,calc(100vw-24px))]",
} as const;

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * The toast card without placement: floating surface, tone glyph, title, message, structured
 * actions, progress and dismiss, with auto-dismiss that pauses on hover, focus and an open stack.
 * `Toast` places it in a corner stack. Not public API: use Toast.
 * @group feedback
 * @use Card content inside the Toast stack and caller-positioned container notices (internal).
 * @avoid Queue placement: Toast. Inline feedback: InlineMessage. Never import it from a feature.
 * @status internal
 * @arc toast-stack
 */
export function ToastCard({
  message,
  title,
  tone,
  count,
  children,
  action,
  actions,
  extra,
  actionsPlacement = "header",
  progress,
  onDismiss,
  dismissDisabled,
  durationMs: durationOption,
  width = "md",
  position = "relative",
  className,
  style,
  frameRef,
  "aria-label": ariaLabel,
}: ToastContentProps & {
  /** `relative` on its own; a self-positioned notice passes `fixed` or `absolute`. */
  position?: "relative" | "fixed" | "absolute";
  className?: string;
  style?: CSSProperties;
  frameRef?: Ref<HTMLDivElement>;
}) {
  const t = useT();
  const stack = useToastStackItem();
  const hasActions = Boolean(actions?.length || extra);
  const durationMs =
    durationOption === undefined
      ? toastDurationMs(tone, Boolean(action) || hasActions)
      : durationOption;
  const surface = useRef<HTMLDivElement>(null);
  useAutoDismiss(surface, {
    durationMs: onDismiss ? durationMs : null,
    paused: dismissDisabled || stack?.paused,
    onExpire: () => onDismiss?.(),
    // A repeat of the same toast raises `count` and so restarts the countdown.
    resetKey: `${title ?? ""}\n${typeof message === "string" ? message : ""}\n${count ?? 1}`,
  });
  const actionButton = action ? <NoticeButton action={action} /> : null;
  const actionRow =(placement: "header" | "footer") =>
    hasActions && actionsPlacement === placement ? (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {actions?.map((item) => (
          <NoticeButton key={item.label} action={item} />
        ))}
        {extra}
        {actionButton}
      </div>
    ) : null;
  const hasBody = Boolean(children || progress || (hasActions && actionsPlacement === "header"));
  // The card is the announced region and the hover/focus timer surface in one element.
  return (
    <ToastStackCard
      ref={(node) => {
        surface.current = node;
        assignRef(frameRef, node);
      }}
      tone={tone}
      count={count}
      // The dismiss control stays visible on an error that does not expire by itself.
      closeAlways={tone === "danger" && durationMs === null}
      title={title}
      description={message}
      action={hasActions ? null : actionButton}
      footer={actionRow("footer")}
      close={
        onDismiss ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Dismiss notice")}
            disabled={dismissDisabled}
            onClick={onDismiss}
          >
            <X className="icon-md" aria-hidden />
          </Button>
        ) : null
      }
      aria-label={ariaLabel}
      style={style}
      className={[stack ? null : position, stack ? null : WIDTH[width], className]
        .filter(Boolean)
        .join(" ")}
    >
      {hasBody ? (
        <>
          {actionRow("header")}
          {children}
          {progress ? (
            <Progress compact value={progress.value * 100} max={100} label={progress.label} />
          ) : null}
        </>
      ) : null}
    </ToastStackCard>
  );
}

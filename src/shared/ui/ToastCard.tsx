import { useEffect, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import { useStableCallback } from "../hooks/useStableCallback";
import { useT } from "../i18n";
import { elapsedSince, monotonicNow } from "../lib/time/timestamps";
import { ToastStackCard, useToastStackItem } from "./arc/toast-stack/toast-stack";
import { Button } from "./Button";
import { X } from "./icons";
import { Progress } from "./Progress";

export type ToastTone = "neutral" | "info" | "success" | "warning" | "danger";

/** Ten seconds of focused window time to read a sentence and reach its action. */
export const TOAST_VISIBLE_MS = 10_000;

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

export type ToastAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Shows progress and blocks a second activation; the caller owns the operation. */
  pending?: boolean;
};

export type ToastContentProps = {
  /** Primary text. With `title`, it is the body under the heading. */
  message?: ReactNode;
  title?: string;
  /** Tone drives the glyph and role (danger announces assertively); never colour alone. */
  tone?: ToastTone;
  /** Extra body, such as a list of rows. Rendered below the message. */
  children?: ReactNode;
  /** One secondary action (Undo, Retry, Open), at the end of the row. */
  action?: ToastAction;
  /** Additional actions under the message, such as "Update all". Use shared Button. */
  actions?: ReactNode;
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
   * Auto-dismiss delay; defaults to ten seconds for every tone, including errors.
   * `null` explicitly keeps the toast until dismissed.
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
 * The toast card without placement: floating surface, tone glyph, title, message, actions,
 * progress and dismiss, with auto-dismiss that pauses on hover, focus and an open stack.
 * `Toast` places it in a corner stack; TransientNotice can position it itself.
 * @group feedback
 * @status internal
 * @arc toast-stack
 */
export function ToastCard({
  message,
  title,
  tone = "info",
  children,
  action,
  actions,
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
  const durationMs = durationOption === undefined ? TOAST_VISIBLE_MS : durationOption;
  const surface = useRef<HTMLDivElement>(null);
  useAutoDismiss(surface, {
    durationMs: onDismiss ? durationMs : null,
    paused: dismissDisabled || stack?.paused,
    onExpire: () => onDismiss?.(),
    resetKey: `${title ?? ""}\n${typeof message === "string" ? message : ""}`,
  });
  const actionButton = action ? (
    <Button
      variant="secondary"
      size="sm"
      shape="pill"
      disabled={action.disabled}
      loading={action.pending}
      onClick={action.onClick}
    >
      {action.label}
    </Button>
  ) : null;
  const actionRow = (placement: "header" | "footer") =>
    actions && actionsPlacement === placement ? (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {actions}
        {actionButton}
      </div>
    ) : null;
  const hasBody = Boolean(children || progress || actions);
  // The card is the announced region and the hover/focus timer surface in one element.
  return (
    <ToastStackCard
      ref={(node) => {
        surface.current = node;
        assignRef(frameRef, node);
      }}
      tone={tone}
      title={title}
      description={message}
      action={actions ? null : actionButton}
      close={
        onDismiss ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            shape="pill"
            iconOnly
            label={t("Dismiss notice")}
            disabled={dismissDisabled}
            onClick={onDismiss}
          >
            <X width={16} height={16} strokeWidth={1.75} aria-hidden />
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
          {actionRow("footer")}
        </>
      ) : null}
    </ToastStackCard>
  );
}

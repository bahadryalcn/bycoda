import { useT } from "../i18n";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { Button } from "./Button";
import { X } from "./icons";
import { Alert, type AlertTone } from "./Alert";
import { Progress } from "./Progress";

const VISIBLE_MS = 7000;

export type TransientNoticeTone = AlertTone;

export interface TransientNoticeProps {
  /** Primary text. Pair with `title` for a heading above it. */
  message?: string;
  title?: string;
  /** Tone drives the icon and role (danger announces assertively); never colour alone. */
  tone?: TransientNoticeTone;
  /** Extra body, such as a list of rows. Rendered below the message. */
  children?: ReactNode;
  /** One secondary action, for example Undo. */
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** Additional header actions, such as "Update all". Use shared Button. */
  actions?: ReactNode;
  /** Determinate progress from 0 to 1, with an accessible label. */
  progress?: { value: number; label: string };
  onDismiss: () => void;
  /** Disables the dismiss control while an operation cannot be interrupted. */
  dismissDisabled?: boolean;
  /** Auto-dismiss delay. `null` keeps the notice until dismissed. */
  durationMs?: number | null;
  /** Corner stack. `top-end` honours `offset` (px) for sibling banners. */
  placement?: "bottom-end" | "top-end";
  offset?: number;
  width?: "md" | "lg";
  /** `viewport` portals to the body; `container` positions inside the nearest positioned parent. */
  anchor?: "viewport" | "container";
  /** Reports the rendered height (0 on unmount), so stacked notices can avoid overlap. */
  onHeightChange?: (height: number) => void;
  "aria-label"?: string;
}

/**
 * A corner notice with tone, optional action, progress and dismiss. Expires after
 * `durationMs` unless it is `null`. Resting elevation is the shared floating shadow.
 */
export function TransientNotice({
  message,
  title,
  tone = "info",
  children,
  action,
  actions,
  progress,
  onDismiss,
  dismissDisabled,
  durationMs = VISIBLE_MS,
  placement = "bottom-end",
  offset,
  width = "md",
  anchor = "viewport",
  onHeightChange,
  "aria-label": ariaLabel,
}: TransientNoticeProps) {
  const t = useT();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = surface.current;
    if (!node || durationMs === null || dismissDisabled) return;
    let remaining = durationMs;
    let started = 0;
    let timer: number | undefined;
    let hovered = node.matches(":hover");
    let focused = node.contains(document.activeElement);
    const pause = () => {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - started));
    };
    const resume = () => {
      if (timer !== undefined || hovered || focused || document.hidden) return;
      started = Date.now();
      timer = window.setTimeout(() => {
        timer = undefined;
        dismiss.current();
      }, remaining);
    };
    const enter = () => {
      hovered = true;
      pause();
    };
    const leave = () => {
      hovered = false;
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
      if (document.hidden) pause();
      else resume();
    };
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointerleave", leave);
    node.addEventListener("focusin", focus);
    node.addEventListener("focusout", blur);
    document.addEventListener("visibilitychange", visibility);
    resume();
    return () => {
      pause();
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("focusin", focus);
      node.removeEventListener("focusout", blur);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [message, title, durationMs, dismissDisabled]);
  useLayoutEffect(() => {
    const node = surface.current;
    if (!node || !onHeightChange) return;
    const measure = () => onHeightChange(node.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return () => onHeightChange(0);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [onHeightChange]);

  const inset = offset ?? 12;
  const position = placement === "top-end" ? { insetBlockStart: inset } : { insetBlockEnd: inset };
  const widthClass =
    width === "lg" ? "w-[min(360px,calc(100vw-24px))]" : "w-[min(340px,calc(100vw-24px))]";
  const notice = (
    <Alert
      ref={surface}
      tone={tone}
      aria-label={ariaLabel}
      style={{
        zIndex: anchor === "viewport" ? LAYER.toast : undefined,
        boxShadow: "var(--shadow-floating)",
        ...position,
      }}
      className={`${anchor === "viewport" ? "fixed" : "absolute"} end-3 ${widthClass}`}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1 self-center break-words">
            {title ? <strong className="text-ui-secondary font-medium">{title}</strong> : message}
          </div>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            label={t("Dismiss notice")}
            tooltip={t("Dismiss notice")}
            disabled={dismissDisabled}
            onClick={onDismiss}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
        {actions || action ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {actions}
            {action ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ) : null}
          </div>
        ) : null}
        {children || progress || (title && message) ? (
          <div className="min-w-0 break-words">
            {title ? message : null}
            {children}
            {progress ? (
              <Progress compact value={progress.value * 100} max={100} label={progress.label} />
            ) : null}
          </div>
        ) : null}
      </div>
    </Alert>
  );
  return anchor === "viewport" ? createPortal(notice, document.body) : notice;
}

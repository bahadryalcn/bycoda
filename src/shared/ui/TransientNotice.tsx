import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import type { AlertTone } from "./Alert";
import { ToastCard, ToastSlot } from "./ToastRegion";

export type TransientNoticeTone = AlertTone;

export interface TransientNoticeProps {
  /** Primary text. Pair with `title` for a heading above it. */
  message?: string;
  title?: string;
  /** Tone drives the icon and role (danger announces assertively); never colour alone. */
  tone?: TransientNoticeTone;
  /** Extra body, such as a list of rows. Rendered below the message. */
  children?: ReactNode;
  /**
   * One secondary action, for example Undo or Retry. It sits under the message.
   * `pending` shows progress and blocks a second activation; the caller owns the operation.
   */
  action?: { label: string; onClick: () => void; disabled?: boolean; pending?: boolean };
  /** Additional header actions, such as "Update all". Use shared Button. */
  actions?: ReactNode;
  /** Determinate progress from 0 to 1, with an accessible label. */
  progress?: { value: number; label: string };
  onDismiss: () => void;
  /** Disables the dismiss control while an operation cannot be interrupted. */
  dismissDisabled?: boolean;
  /** Auto-dismiss delay; defaults to ten seconds of focused window time. `null` keeps the notice until dismissed. */
  durationMs?: number | null;
  /**
   * Corner stack. Viewport notices without `offset`/`onHeightChange` join the shared corner
   * stack (see `ToastRegion`) and offset themselves by layout.
   */
  placement?: "bottom-end" | "top-end";
  /**
   * @deprecated Legacy manual offset (px) from the corner for sibling banners. A viewport notice
   * without it stacks automatically; remove it when the sibling also stacks.
   */
  offset?: number;
  width?: "md" | "lg";
  /** `viewport` portals to the body; `container` positions inside the nearest positioned parent. */
  anchor?: "viewport" | "container";
  /**
   * @deprecated Reports the rendered height (0 on unmount) for manual stacking. Stacked notices
   * need no coordination; passing this keeps the legacy fixed position.
   */
  onHeightChange?: (height: number) => void;
  "aria-label"?: string;
}

/**
 * A corner notice with tone, optional action, progress and dismiss. Expires after
 * `durationMs` unless it is `null`. The card is the shared `ToastCard`; a viewport notice
 * stacks in its corner with every other toast.
 * @group feedback
 * @use Existing corner notice that needs `anchor="container"` placement or one secondary action.
 * @avoid New background feedback: Toast or useToast. Inline result near a control: InlineMessage. Persistent page notice: Alert.
 */
export function TransientNotice({
  placement = "bottom-end",
  offset,
  anchor = "viewport",
  onHeightChange,
  ...props
}: TransientNoticeProps) {
  if (anchor === "viewport" && offset === undefined && !onHeightChange)
    return (
      <ToastSlot placement={placement}>
        <ToastCard {...props} />
      </ToastSlot>
    );
  return (
    <PositionedNotice
      {...props}
      placement={placement}
      offset={offset}
      anchor={anchor}
      onHeightChange={onHeightChange}
    />
  );
}

/** The legacy self-positioned notice, kept for callers that still coordinate offsets. */
function PositionedNotice({
  placement = "bottom-end",
  offset,
  anchor = "viewport",
  onHeightChange,
  ...props
}: TransientNoticeProps) {
  const frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = frame.current;
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
  const notice = (
    <ToastCard
      {...props}
      frameRef={frame}
      style={{ zIndex: anchor === "viewport" ? LAYER.toast : undefined, ...position }}
      position={anchor === "viewport" ? "fixed" : "absolute"}
      className="end-3"
    />
  );
  return anchor === "viewport" ? createPortal(notice, document.body) : notice;
}

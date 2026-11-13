import type { ReactNode } from "react";
import type { AlertTone } from "./Alert";
import { ToastCard } from "./ToastCard";
import { Toast } from "./ToastRegion";

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
   * Corner stack. Viewport notices join the shared corner
   * stack (see `ToastRegion`): newest in front, older ones tucked behind.
   */
  placement?: "bottom-end" | "top-end";
  width?: "md" | "lg";
  /** `viewport` portals to the body; `container` positions inside the nearest positioned parent. */
  anchor?: "viewport" | "container";
  "aria-label"?: string;
}

/**
 * A corner notice with tone, optional action, progress and dismiss. Expires after
 * `durationMs` unless it is `null`. The card is the shared `ToastCard`; a viewport notice
 * stacks in its corner with every other toast.
 * Hand-positioned transient notice cards; the shared ToastCard owns their appearance.
 * @group feedback
 * @use Placement adapter for a ToastCard inside a positioned container or the shared viewport Toast stack.
 * @avoid New background feedback: Toast or useToast. Inline result near a control: InlineMessage. Persistent page notice: Alert.
 */
export function TransientNotice({
  placement = "bottom-end",
  anchor = "viewport",
  ...props
}: TransientNoticeProps) {
  if (anchor === "viewport") return <Toast placement={placement} {...props} />;
  const inset = 12;
  const position = placement === "top-end" ? { insetBlockStart: inset } : { insetBlockEnd: inset };
  return <ToastCard {...props} style={position} position="absolute" className="end-3" />;
}

import type { ReactNode } from "react";
import type { AlertTone } from "./Alert";
import type { NoticeAction } from "./Notice";
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
  action?: NoticeAction;
  /** Additional structured actions, such as "Update all". */
  actions?: NoticeAction[];
  /** Escape for one non-button control beside the actions (an ErrorDetails trigger). */
  extra?: ReactNode;
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
  "aria-label"?: string;
}

/**
 * A corner notice with tone, optional action, progress and dismiss. Expires after
 * `durationMs` unless it is `null`. It is a Toast in its corner stack.
 * @group feedback
 * @use Existing corner notices only; new ones use Toast.
 * @avoid New background feedback: Toast or useToast. Inline result near a control: InlineMessage. Persistent page notice: Alert.
 */
export function TransientNotice({ placement = "bottom-end", ...props }: TransientNoticeProps) {
  return <Toast placement={placement} {...props} />;
}

import type { ReactNode } from "react";
import { Button } from "./Button";
import { CheckCircle, CircleAlert, Info, TriangleAlert } from "./icons";
import styles from "./Notice.module.css";

export type NoticeTone = "info" | "success" | "warning" | "danger" | "neutral";

/** A follow-up the notice renders itself: its label, handler and the pending state the caller owns. */
export type NoticeAction = {
  label: string;
  onClick: () => void;
  /** Shows progress and blocks a second activation; the caller owns the operation. */
  pending?: boolean;
  disabled?: boolean;
  /** Accessible name when the visible label alone is ambiguous (a bare "Copy" beside an address). */
  ariaLabel?: string;
};

/** One glyph per tone for every notice, so tone never rides on colour alone. */
const GLYPH = {
  info: Info,
  success: CheckCircle,
  warning: TriangleAlert,
  danger: CircleAlert,
  neutral: Info,
} as const;

/** The tone is carried by the glyph alone; copy stays neutral. */
const GLYPH_INK: Record<NoticeTone, string> = {
  info: "text-(--ui-tone-info-fg)",
  success: "text-(--ui-tone-success-fg)",
  warning: "text-(--ui-tone-warning-fg)",
  danger: "text-(--ui-tone-danger-fg)",
  neutral: "text-(--ui-text-muted)",
};

/** Notice size: inline is a caption line (14px glyph); box is Alert, Toast and block states (16px glyph). */
export type NoticeSize = "inline" | "box";

const FIRST_LINE: Record<NoticeSize, string> = {
  inline: "h-(--ui-leading-caption)",
  box: "h-(--ui-leading-secondary)",
};

/**
 * A box exactly one first line tall that centres its child, so a glyph, action or dismiss control
 * sits on the first line of one-line, wrapped and titled copy alike.
 *
 * @group feedback
 * @use Internal part of the notice anatomy shared by Alert, InlineMessage, Toast and empty states.
 * @avoid Direct use in a feature: use Alert, InlineMessage/InlineError, Toast or EmptyState.
 * @status internal
 *
 * @group feedback
 * @use Internal part of the notice anatomy shared by Alert, InlineMessage, Toast and empty states.
 * @avoid Direct use in a feature: use Alert, InlineMessage/InlineError, Toast or EmptyState.
 * @status internal
 */
export function NoticeSlot({
  size,
  className,
  children,
}: {
  size: NoticeSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={["flex shrink-0 items-center", FIRST_LINE[size], className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}

/** The tone glyph (or a caller icon) inside a first-line-tall box. `icon={null}` renders nothing.
 *
 * @group feedback
 * @use Internal part of the notice anatomy shared by Alert, InlineMessage, Toast and empty states.
 * @avoid Direct use in a feature: use Alert, InlineMessage/InlineError, Toast or EmptyState.
 * @status internal
 */
export function NoticeGlyph({
  tone,
  size,
  icon,
}: {
  tone: NoticeTone;
  size: NoticeSize;
  icon?: ReactNode | null;
}) {
  if (icon === null) return null;
  const Glyph = GLYPH[tone];
  return (
    <NoticeSlot size={size} className={GLYPH_INK[tone]}>
      <span aria-hidden className="flex">
        {icon === undefined ? (
          <Glyph className={size === "inline" ? "icon-sm" : "icon-md"} aria-hidden />
        ) : (
          icon
        )}
      </span>
    </NoticeSlot>
  );
}

/** Class that plays the one notice enter motion (opacity and a short rise; fade under reduced motion). */
export const noticeEnterClass = styles.enter;

/** A text link after inline copy: caption height, so it never grows the line.
 *
 * @group feedback
 * @use Internal part of the notice anatomy shared by Alert, InlineMessage, Toast and empty states.
 * @avoid Direct use in a feature: use Alert, InlineMessage/InlineError, Toast or EmptyState.
 * @status internal
 */
export function NoticeLink({ action }: { action: NoticeAction }) {
  return (
    <Button
      variant="link"
      layout="text"
      loading={action.pending ?? false}
      disabled={action.disabled}
      aria-label={action.ariaLabel}
      onClick={action.onClick}
    >
      {action.label}
    </Button>
  );
}

/** A secondary small button for a box, toast or block footer.
 *
 * @group feedback
 * @use Internal part of the notice anatomy shared by Alert, InlineMessage, Toast and empty states.
 * @avoid Direct use in a feature: use Alert, InlineMessage/InlineError, Toast or EmptyState.
 * @status internal
 */
export function NoticeButton({ action }: { action: NoticeAction }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={action.pending ?? false}
      disabled={action.disabled}
      aria-label={action.ariaLabel}
      onClick={action.onClick}
    >
      {action.label}
    </Button>
  );
}

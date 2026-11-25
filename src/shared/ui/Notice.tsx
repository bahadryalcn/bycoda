import type { ReactNode } from "react";
import { Button } from "./Button";
import { CheckCircle, CircleAlert, Info, TriangleAlert } from "./icons";
import styles from "./Notice.module.css";

export type NoticeTone = "info" | "success" | "warning" | "danger" | "neutral";

/** A follow-up the notice renders itself: its label, handler and the pending state the caller owns. */
export type NoticeAction = {
  label: string;
  onClick: () => void;
  /** Hierarchy for a button action. Inline actions render as links. */
  variant?: "primary" | "secondary";
  /** Shows progress and blocks a second activation; the caller owns the operation. */
  pending?: boolean;
  disabled?: boolean;
  /** Accessible name when the visible label alone is ambiguous (a bare "Copy" beside an address). */
  ariaLabel?: string;
  /** Tooltip shown while `disabled`, naming why the action is unavailable. */
  disabledReason?: string;
  /** Tooltip that adds detail the label cannot carry (the scope of a grant). Never repeat the label. */
  tooltip?: string;
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
  overlay,
}: {
  tone: NoticeTone;
  size: NoticeSize;
  icon?: ReactNode | null;
  /** The notice sits on the dark overlay scrim: the glyph takes `--ui-overlay-ink` instead of the tone. */
  overlay?: boolean;
}) {
  if (icon === null) return null;
  const Glyph = GLYPH[tone];
  return (
    <NoticeSlot size={size} className={overlay ? "text-(--ui-overlay-ink)" : GLYPH_INK[tone]}>
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

/**
 * Inner spacing of a state (EmptyState, LoadingText, InlineError, InlineMessage), on the Surface
 * padding scale. `none` (default) adds nothing: the surrounding row, panel or form owns the gap.
 * `row` (8/12) sits a state inside a list row or form; `panel` (12/16) gives it a panel's breathing room.
 * Alert and the toast card use the same 8/12 inset through `--ui-space-2` / `--ui-space-3`.
 */
export type StateInset = "none" | "row" | "panel";

const STATE_INSET_CLASS: Record<StateInset, string> = {
  none: "",
  row: "px-3 py-2",
  panel: "px-4 py-3",
};

/** Tailwind classes for a state's `inset`; empty for `none` or unset. */
export function stateInsetClass(inset: StateInset | undefined): string {
  return STATE_INSET_CLASS[inset ?? "none"];
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
      truncate
      aria-label={action.ariaLabel}
      disabledReason={action.disabledReason}
      tooltip={action.tooltip}
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
export function NoticeButton({ action, quiet }: { action: NoticeAction; quiet?: boolean }) {
  return (
    <Button
      variant={quiet ? "ghost" : (action.variant ?? "secondary")}
      size="sm"
      loading={action.pending ?? false}
      disabled={action.disabled}
      aria-label={action.ariaLabel}
      disabledReason={action.disabledReason}
      tooltip={action.tooltip}
      onClick={action.onClick}
    >
      {action.label}
    </Button>
  );
}

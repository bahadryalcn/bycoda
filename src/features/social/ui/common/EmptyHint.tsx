import { t } from "../../../../shared/i18n";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import type { IllustrationName } from "../../../../shared/ui/StateIllustration";
import type { NoticeAction } from "../../../../shared/ui/Notice";
import { Text } from "../../../../shared/ui/Text";
import type { ActionGate } from "./DisabledReason";
import "./common.css";

export type EmptyHintFillAction = { onClick: () => void } & ActionGate;

export type EmptyHintAction = { label: string } & EmptyHintFillAction;

export type EmptyHintProps = {
  /** One sentence describing the empty state. */
  message: string;
  /** The single primary action of the screen or panel. */
  action?: EmptyHintAction;
  /** Optional AI shortcut that fills the empty state. */
  fillWithAi?: EmptyHintFillAction;
  /** A scene turns the hint into a centered block state that fills the free space of its screen. */
  illustration?: IllustrationName;
  /** Block state title; only with `illustration`. */
  title?: string;
};

/** Empty state: one sentence, one primary action, optionally "Fill with AI". */
export function EmptyHint({ message, action, fillWithAi, illustration, title }: EmptyHintProps) {
  const toAction = (step: EmptyHintFillAction, label: string): NoticeAction => ({
    label,
    onClick: step.onClick,
    disabled: step.disabled === true,
  });
  const reasons = [action, fillWithAi].flatMap((step) =>
    step?.disabled === true ? [step.disabledReason] : [],
  );
  return (
    <EmptyState
      {...(illustration
        ? { context: "page", illustration, title, className: "min-h-0 flex-1" }
        : { size: "inline" })}
      kind="empty"
      description={message}
      action={action ? toAction(action, action.label) : undefined}
      secondaryAction={fillWithAi ? toAction(fillWithAi, t("Fill with AI")) : undefined}
      extra={
        reasons.length ? (
          <Text as="span" tone="secondary" leading="snug">
            {reasons.join(" ")}
          </Text>
        ) : undefined
      }
    />
  );
}

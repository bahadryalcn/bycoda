import { t } from "../../../../shared/i18n";
import { EmptyState } from "../../../../shared/ui/EmptyState";
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
};

/** Empty state: one sentence, one primary action, optionally "Fill with AI". */
export function EmptyHint({ message, action, fillWithAi }: EmptyHintProps) {
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
      size="inline"
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

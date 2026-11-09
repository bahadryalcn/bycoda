import { t } from "../../../../shared/i18n";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { DisabledReason, gateProps, type ActionGate } from "./DisabledReason";
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

/** Empty state: one sentence, one primary button, optionally "Fill with AI". */
export function EmptyHint({ message, action, fillWithAi }: EmptyHintProps) {
  const buttons =
    action || fillWithAi ? (
      <span className="social-empty-hint-actions">
        {action ? (
          <DisabledReason
            variant="primary"
            size="sm"
            onClick={action.onClick}
            {...gateProps(action)}
          >
            {action.label}
          </DisabledReason>
        ) : null}
        {fillWithAi ? (
          <DisabledReason
            variant="secondary"
            size="sm"
            onClick={fillWithAi.onClick}
            {...gateProps(fillWithAi)}
          >
            {t("Fill with AI")}
          </DisabledReason>
        ) : null}
      </span>
    ) : undefined;
  return <EmptyState context="list" description={message} action={buttons} />;
}

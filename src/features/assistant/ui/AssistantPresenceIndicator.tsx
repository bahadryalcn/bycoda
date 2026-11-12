import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import {
  assistantPresencePresentation,
  type AssistantPresenceState,
} from "../model/assistantPresencePresentation";
import styles from "./AssistantPresenceIndicator.module.css";

export type AssistantPresenceIndicatorProps = {
  state: AssistantPresenceState;
  label?: string;
  className?: string;
  /** A decorative mark beside an already visible option label. */
  markOnly?: boolean;
};

export function AssistantPresenceIndicator({
  state,
  label,
  className,
  markOnly = false,
}: AssistantPresenceIndicatorProps) {
  useLocale();
  const presentation = assistantPresencePresentation(state);
  return (
    <span
      className={[styles.indicator, className].filter(Boolean).join(" ")}
      data-presence-state={presentation.state}
      data-presence-tone={presentation.tone}
      aria-hidden={markOnly || undefined}
    >
      <span className={styles.mark} aria-hidden="true" />
      {!markOnly && (
        <Text size="inherit" tone="inherit" truncate className={styles.label}>
          {label ?? t(presentation.label)}
        </Text>
      )}
    </span>
  );
}

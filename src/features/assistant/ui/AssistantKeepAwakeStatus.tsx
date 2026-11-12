import type { AssistantKeepAwakeStatus as Status } from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import styles from "./AssistantView.module.css";
import { Text } from "../../../shared/ui/Text";

/** Requested policy and actual native activation are deliberately distinct. */
export function AssistantKeepAwakeStatus({
  state,
  compact = false,
}: {
  state?: Status;
  compact?: boolean;
}) {
  if (compact && !state?.requested && !state?.active && !state?.error) return null;
  const label = !state
    ? t("Sleep prevention status unavailable")
    : state.active
      ? t("Keeping this computer awake")
      : state.requested
        ? !state.supported
          ? t("Sleep prevention is unavailable on this Host")
          : t("Waiting to prevent sleep")
        : t("Sleep prevention is off");
  return (
    <Text
      as="div"
      role={state?.error ? "alert" : "status"}
      size={state?.error ? "caption" : "micro"}
      tone={state?.error ? "danger" : "secondary"}
      leading="inherit"
      className={styles.muted}
      data-assistant-keep-awake={
        state?.active ? "active" : state?.requested ? "requested" : state ? "off" : "unknown"
      }
    >
      {label}
      {state?.error && <> · {state.error}</>}
    </Text>
  );
}

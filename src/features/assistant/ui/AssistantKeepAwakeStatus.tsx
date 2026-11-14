import type { AssistantKeepAwakeStatus as Status } from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import styles from "./AssistantKeepAwakeStatus.module.css";
import { Text } from "../../../shared/ui/Text";

/**
 * One sentence for the keep-awake state. `plan` is the owner's drafted policy: while nothing is
 * requested yet it says what will happen instead of reporting "off" beside switches that are on.
 */
export function keepAwakeLabel(
  state: Status | undefined,
  plan?: { working: boolean; away: boolean },
) {
  if (!state) return t("Sleep prevention status unavailable");
  if (state.active) return t("Keeping this computer awake");
  if (state.requested)
    return state.supported
      ? t("Waiting to prevent sleep")
      : t("Sleep prevention is unavailable on this Host");
  if (plan?.working && plan.away)
    return t("Will keep this computer awake while jobs run or you are away");
  if (plan?.away) return t("Will keep this computer awake once you are away");
  if (plan?.working) return t("Will keep this computer awake while jobs run");
  return t("Sleep prevention is off");
}

/** Requested policy and actual native activation are deliberately distinct. */
export function AssistantKeepAwakeStatus({
  state,
  compact = false,
}: {
  state?: Status;
  compact?: boolean;
}) {
  if (compact && !state?.requested && !state?.active && !state?.error) return null;
  const label = keepAwakeLabel(state);
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

import { useEffect, useState } from "react";
import { t } from "../../../shared/i18n";
import type { AssistantSnapshot } from "../../../shared/model/host-contracts/assistant";
import { assistantPresenceRecheckDelay, assistantPresenceState } from "../model/assistantBriefing";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { LiveText } from "../../../shared/ui/LiveText";
import { Text } from "../../../shared/ui/Text";
import { AssistantPresenceIndicator } from "./AssistantPresenceIndicator";
import styles from "./AssistantPresenceIndicator.module.css";

function label(state: string) {
  switch (state) {
    case "present":
      return t("Here");
    case "idle":
      return t("Idle");
    case "away":
      return t("Away");
    case "locked":
      return t("Locked");
    case "dnd":
      return t("Do not disturb");
    default:
      return t("Offline");
  }
}
export function AssistantPresenceStatus({
  snapshot,
  details = false,
  compact = false,
  offline = false,
}: {
  snapshot: Pick<AssistantSnapshot, "presence" | "automaticPresence" | "effectivePresence">;
  details?: boolean;
  compact?: boolean;
  /** The Host could not be read, so the snapshot's availability is not current. */
  offline?: boolean;
}) {
  const [tick, refresh] = useState(0);
  const automatic = snapshot.automaticPresence;
  // Effect reason: freshness is a function of the clock; one timeout at the next fresh/stale
  // boundary re-renders the chip, instead of a fixed 15 s tick on every mounted chip (#315).
  useEffect(() => {
    const delay = assistantPresenceRecheckDelay(automatic, Date.now());
    if (delay === undefined) return;
    const timer = setTimeout(() => refresh((value) => value + 1), delay);
    return () => clearTimeout(timer);
  }, [automatic, tick]);
  const state = assistantPresenceState(snapshot, Date.now());
  const effective = offline ? "offline" : state.effective;
  const announcement = (
    <LiveText
      className="sr-only"
      text={t("Current availability: {p0}", { p0: label(effective) })}
    />
  );
  if (compact)
    return (
      <span>
        <AssistantPresenceIndicator state={effective} />
        {announcement}
      </span>
    );
  return (
    <div className={styles.status}>
      <span>
        <AssistantPresenceIndicator state={effective} />
        {announcement}
      </span>
      {details && (
        <InfoPopover label={t("About computer presence")}>
          <Text as="p" tone="muted" leading="inherit">
            {t("Computer presence: {p0}", { p0: label(state.detected) })}
          </Text>
          <Text as="p" tone="muted" leading="inherit">
            {t(
              "Automatic activity comes from this computer. Your Away or Do not disturb choice takes priority.",
            )}
          </Text>
        </InfoPopover>
      )}
    </div>
  );
}

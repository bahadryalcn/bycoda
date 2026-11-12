import { useState } from "react";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { InlineError } from "../../../../shared/ui/InlineError";
import { assistantPolicy } from "../../../../shared/model/assistantPolicy";
import {
  workerContextSettings,
  validWorkerContextSettings,
} from "../../../../shared/model/assistantContext";
import { AdvancedSettings } from "../../../settings/public/settingsControls";
import { ProfileNumber } from "./ProfileControls";
import { useProfileRows } from "./SettingsProfileRow";
import styles from "./costUsage.module.css";
import viewStyles from "../AssistantView.module.css";
import { Text } from "../../../../shared/ui/Text";
import roleStyles from "../AssistantProfileFields.module.css";

/** The cost and context explanation, shown beside the section title. */
export function AssistantCostInfo() {
  return (
    <InfoPopover label={t("About cost and context")}>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t("Local scheduling limits, not a provider billing cap.")}
      </Text>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t(
          "Zero disables follow-ups and automatic recovery. Manual conversations always wait for you after their limit.",
        )}
      </Text>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t(
          "Reservations guide local scheduling. Provider charges are not capped when usage or output limits are unavailable.",
        )}
      </Text>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t(
          "Claude utility requests include an output token allowance. Codex uses a local text limit because its integration cannot set an output token limit. These are not total billing caps.",
        )}
      </Text>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t(
          "These limits estimate retained text. Summaries, daily renewal, review reservations and a 1 MB safety limit can shorten it earlier. They do not guarantee the provider's context window or charges.",
        )}
      </Text>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t(
          "Messages to workers also use the worker's context. Unknown usage is not counted as zero.",
        )}
      </Text>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t(
          "Worker limits use the first threshold reached: token count or percentage of the provider context window.",
        )}
      </Text>
    </InfoPopover>
  );
}

/** Supervisor review limits, context thresholds and optional worker context limits. */
export function AssistantCostFields({
  value,
  onChange,
}: {
  value: AssistantProfilePatch;
  onChange: (patch: AssistantProfilePatch) => void;
}) {
  const rows = useProfileRows();
  const [advancedWorkerContext, setAdvancedWorkerContext] = useState(false);
  const workerContext = workerContextSettings(value);
  const policy = assistantPolicy(value);
  const number = (
    key: keyof AssistantProfilePatch,
    label: string,
    min: number,
    max: number,
    fallback?: number,
    unit?: string,
  ) => (
    <ProfileNumber
      label={label}
      value={value[key] ?? fallback}
      min={min}
      max={max}
      unit={unit}
      onChange={(next) => onChange({ [key]: next })}
    />
  );
  const limits = (
    <>
      {number("chiefWakeLimit", "Supervisor reviews", 1, 120, policy.chiefWakeLimit, "/hour")}
      {number("nudgeLimit", "Follow-ups", 0, 2, policy.nudgeLimit, "before recovery")}
      {number("summaryRefreshMessages", "Summary every", 10, 200, 20, "messages")}
      {number("perWakeTokenCap", "Review reservation", 1000, 1_000_000, undefined, "tokens")}
      {number("chiefSoftContext", "Compact at", 10_000, 1_000_000, undefined, "tokens")}
      {number("chiefHardContext", "Renew at", 20_000, 2_000_000, undefined, "tokens")}
    </>
  );
  const workerLimits = (
    <>
      {number(
        "workerSoftContext",
        "Worker compact at",
        10000,
        999999,
        workerContext.workerSoftContext,
        "tokens",
      )}
      {number(
        "workerHardContext",
        "Worker fresh session at",
        10001,
        1000000,
        workerContext.workerHardContext,
        "tokens",
      )}
      {number(
        "workerCompactPercent",
        "Worker compact at",
        1,
        98,
        workerContext.workerCompactPercent,
        "%",
      )}
      {number(
        "workerHandoffPercent",
        "Worker fresh session at",
        2,
        99,
        workerContext.workerHandoffPercent,
        "%",
      )}
    </>
  );
  const contextError = !validWorkerContextSettings(value) && (
    <InlineError>{t("Worker context limits must increase from compact to handoff.")}</InlineError>
  );
  if (rows)
    return (
      <>
        {limits}
        <AdvancedSettings title={t("Advanced worker context limits")} defaultOpen={false}>
          {workerLimits}
        </AdvancedSettings>
        {contextError}
      </>
    );
  return (
    <div className={`${roleStyles.wide} ${styles.cost}`}>
      <div className={styles.fieldGrid}>{limits}</div>
      <Disclosure
        size="sm"
        summary={t("Advanced worker context limits")}
        open={advancedWorkerContext}
        onOpenChange={setAdvancedWorkerContext}
      >
        <div className={styles.fieldGrid}>{workerLimits}</div>
      </Disclosure>
      {contextError}
    </div>
  );
}

import { Fragment, useState } from "react";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { InlineError } from "../../../../shared/ui/InlineError";
import { assistantPolicy } from "../../../../shared/model/assistantPolicy";
import {
  DEFAULT_WORKER_CONTEXT_SETTINGS,
  workerContextSettings,
  validWorkerContextSettings,
} from "../../../../shared/model/assistantContext";
import { AdvancedSettings, Row } from "../../../../shared/ui/settings";
import { Button } from "../../../../shared/ui/Button";
import { ProfileNumber } from "./ProfileControls";
import { useProfileRows } from "./SettingsProfileRow";
import styles from "./costUsage.module.css";
import { Text } from "../../../../shared/ui/Text";
import roleStyles from "../AssistantProfileFields.module.css";

/** The cost and context explanation, shown beside the section title. */
export function AssistantCostInfo() {
  return (
    <InfoPopover label={t("About cost and context")}>
      <Text as="p" size="secondary">
        {t("Local scheduling limits, not a provider billing cap.")}
      </Text>
      <Text as="p" size="secondary">
        {t(
          "Zero disables follow-ups and automatic recovery. Manual conversations always wait for you after their limit.",
        )}
      </Text>
      <Text as="p" size="secondary">
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
  const [workerReset, setWorkerReset] = useState(0);
  const workerContext = workerContextSettings(value);
  const automatic = Object.entries(DEFAULT_WORKER_CONTEXT_SETTINGS).every(
    ([key, limit]) => workerContext[key as keyof typeof workerContext] === limit,
  );
  const restoreDefaults = () => {
    onChange({ ...DEFAULT_WORKER_CONTEXT_SETTINGS });
    // Number fields keep raw draft text across disclosure toggles.
    setWorkerReset((current) => current + 1);
  };
  const contextMode = (
    <Row
      label={t("Worker context limits")}
      modified={!automatic}
      onReset={restoreDefaults}
      resetLabel={t("Restore defaults")}
    >
      <Text size="secondary">{automatic ? t("Automatic") : t("Custom")}</Text>
    </Row>
  );
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
      {number("chiefWakeLimit", t("Supervisor reviews"), 1, 120, policy.chiefWakeLimit, t("/hour"))}
      {number("nudgeLimit", t("Follow-ups"), 0, 2, policy.nudgeLimit, t("before recovery"))}
      {number("summaryRefreshMessages", t("Summary every"), 10, 200, 20, t("messages"))}
      {number("perWakeTokenCap", t("Reserve per review"), 1000, 1_000_000, undefined, t("tokens"))}
      {number(
        "chiefSoftContext",
        t("Compact supervisor context"),
        10_000,
        1_000_000,
        undefined,
        t("tokens"),
      )}
      {number(
        "chiefHardContext",
        t("Restart supervisor context"),
        20_000,
        2_000_000,
        undefined,
        t("tokens"),
      )}
    </>
  );
  const workerLimits = (
    <Fragment key={workerReset}>
      {number(
        "workerSoftContext",
        t("Compact by token count"),
        10000,
        999999,
        workerContext.workerSoftContext,
        t("tokens"),
      )}
      {number(
        "workerHardContext",
        t("Start fresh by token count"),
        10001,
        1000000,
        workerContext.workerHardContext,
        t("tokens"),
      )}
      {number(
        "workerCompactPercent",
        t("Compact by context usage"),
        1,
        98,
        workerContext.workerCompactPercent,
        t("%"),
      )}
      {number(
        "workerHandoffPercent",
        t("Start fresh by context usage"),
        2,
        99,
        workerContext.workerHandoffPercent,
        t("%"),
      )}
    </Fragment>
  );
  const contextError = !validWorkerContextSettings(value) && (
    <InlineError>{t("Worker context limits must increase from compact to handoff.")}</InlineError>
  );
  if (rows)
    return (
      <>
        {contextMode}
        <AdvancedSettings title={t("Supervisor limits")} keepMounted>
          {limits}
        </AdvancedSettings>
        <AdvancedSettings
          title={t("Advanced worker context limits")}
          defaultOpen={!validWorkerContextSettings(value)}
          keepMounted
        >
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
        {!automatic && (
          <Button type="button" onClick={restoreDefaults}>
            {t("Restore defaults")}
          </Button>
        )}
      </Disclosure>
      {contextError}
    </div>
  );
}

import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Switch } from "../../../../shared/ui/Switch";
import { assistantPolicy, validAssistantPolicy } from "../../../../shared/model/assistantPolicy";
import { AssistantPresetNumber } from "../AssistantProfileControls";
import { ProfileSelect } from "./ProfileControls";
import { ScheduleHours } from "./ScheduleHours";
import { ProfileSwitch, useProfileRows } from "./SettingsProfileRow";
import styles from "./schedule.module.css";
import viewStyles from "../AssistantView.module.css";
import { Text } from "../../../../shared/ui/Text";
import roleStyles from "../AssistantProfileFields.module.css";
import { AdvancedSettings } from "../../../settings/public/settingsControls";

const notificationOptions = [
  ["all", "All updates"],
  ["urgent", "Urgent only"],
  ["none", "None"],
] as const;

/** The presence and hours explanation, shown beside the section title. */
export function AssistantScheduleInfo() {
  return (
    <InfoPopover label={t("About presence and hours")}>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t("Idle and away are based on inactivity.")}
      </Text>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t(
          "Outside work hours, new work waits and accepted turns can finish. Quiet hours hold notifications for the next briefing.",
        )}
      </Text>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t(
          "Task observations use only projects enabled for manual supervision. Notifications still follow presence and quiet hours.",
        )}
      </Text>
    </InfoPopover>
  );
}

/** Presence thresholds, working and quiet hours, notifications, keep-awake and the stall timeout. */
export function AssistantScheduleFields({
  value,
  onChange,
  observationTasksAvailable,
  part = "all",
}: {
  value: AssistantProfilePatch;
  onChange: (patch: AssistantProfilePatch) => void;
  observationTasksAvailable: boolean;
  /** The settings dialog renders presence and notifications as two titled groups. */
  part?: "all" | "presence" | "notifications";
}) {
  const rows = useProfileRows();
  const policy = assistantPolicy(value);
  const minutes = (values: number[]) =>
    values.map((value) => ({ value, label: t("{p0} min", { p0: value }) }));
  const availabilityInfo = (
    <InfoPopover label={t("About availability")}>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t(
          "Matching work hours allow work all day. Outside these hours, accepted turns can finish; new work waits.",
        )}
      </Text>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t("Do not disturb and quiet hours hold notifications for your next briefing.")}
      </Text>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t(
          "Prevents sleep only while this Host is supervising active jobs. Locking the screen still protects your desktop.",
        )}
      </Text>
      <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
        {t("Work tracking continues while voice is off.")}
      </Text>
    </InfoPopover>
  );
  const validPolicy = validAssistantPolicy(value);
  if (rows && part === "notifications")
    return (
      <>
        <ProfileSelect
          label={t("When present")}
          value={String(value.notificationPresent ?? policy.notificationPresent)}
          options={notificationOptions}
          onValueChange={(next) =>
            onChange({ notificationPresent: next as AssistantProfilePatch["notificationPresent"] })
          }
        />
        <ProfileSelect
          label={t("When away")}
          value={String(value.notificationAway ?? policy.notificationAway)}
          options={notificationOptions}
          onValueChange={(next) =>
            onChange({ notificationAway: next as AssistantProfilePatch["notificationAway"] })
          }
        />
        <ProfileSwitch
          label={t("Task done")}
          description={t("Observed tasks in projects enabled for manual supervision.")}
          checked={policy.observationTaskDone}
          onCheckedChange={(observationTaskDone) => onChange({ observationTaskDone })}
        />
        <ProfileSwitch
          label={t("Needs input")}
          checked={policy.observationTaskNeedsInput}
          onCheckedChange={(observationTaskNeedsInput) => onChange({ observationTaskNeedsInput })}
        />
      </>
    );
  if (rows)
    return (
      <>
        <ScheduleHours
          kind="work"
          start={policy.activeStart}
          end={policy.activeEnd}
          onChange={(activeStart, activeEnd) => onChange({ activeStart, activeEnd })}
        />
        <ScheduleHours
          kind="quiet"
          start={value.quietStart ?? 22}
          end={value.quietEnd ?? 8}
          onChange={(quietStart, quietEnd) => onChange({ quietStart, quietEnd })}
        />
        <ProfileSwitch
          label={t("Keep awake while jobs run")}
          info={availabilityInfo}
          checked={value.keepAwakeWhileWorking ?? false}
          onCheckedChange={(keepAwakeWhileWorking) => onChange({ keepAwakeWhileWorking })}
        />
        <AdvancedSettings
          title={t("Inactivity and recovery")}
          defaultOpen={!validPolicy}
          keepMounted
        >
          <AssistantPresetNumber
            label={t("Idle after")}
            value={value.idleMinutes ?? policy.idleMinutes}
            min={1}
            max={1440}
            unit={t("minutes")}
            presets={minutes([5, 10, 15, 30, 60])}
            onChange={(idleMinutes) => onChange({ idleMinutes })}
          />
          <AssistantPresetNumber
            label={t("Away after")}
            value={value.awayMinutes ?? policy.awayMinutes}
            min={2}
            max={10080}
            unit={t("minutes")}
            presets={minutes([15, 30, 60, 120, 240])}
            onChange={(awayMinutes) => onChange({ awayMinutes })}
          />
          <AssistantPresetNumber
            label={t("Stall timeout")}
            value={value.stallMinutes ?? 15}
            min={5}
            max={1440}
            unit={t("minutes")}
            presets={minutes([5, 15, 30, 60, 120])}
            onChange={(stallMinutes) => onChange({ stallMinutes })}
          />
        </AdvancedSettings>
        {!validPolicy && <InlineError>{t("Away must start later than idle.")}</InlineError>}
      </>
    );
  return (
    <div className={`${roleStyles.wide} ${styles.schedule}`}>
      <div className={styles.grid}>
        <AssistantPresetNumber
          label={t("Idle after")}
          value={value.idleMinutes ?? policy.idleMinutes}
          min={1}
          max={1440}
          unit={t("minutes")}
          presets={minutes([5, 10, 15, 30, 60])}
          onChange={(idleMinutes) => onChange({ idleMinutes })}
        />
        <AssistantPresetNumber
          label={t("Away after")}
          value={value.awayMinutes ?? policy.awayMinutes}
          min={2}
          max={10080}
          unit={t("minutes")}
          presets={minutes([15, 30, 60, 120, 240])}
          onChange={(awayMinutes) => onChange({ awayMinutes })}
        />
        {!validPolicy && (
          <InlineError className={styles.wide}>{t("Away must start later than idle.")}</InlineError>
        )}
        <ScheduleHours
          kind="work"
          start={policy.activeStart}
          end={policy.activeEnd}
          onChange={(activeStart, activeEnd) => onChange({ activeStart, activeEnd })}
        />
        <ScheduleHours
          kind="quiet"
          start={value.quietStart ?? 22}
          end={value.quietEnd ?? 8}
          onChange={(quietStart, quietEnd) => onChange({ quietStart, quietEnd })}
        />
        <ProfileSelect
          label={t("When present")}
          value={String(value.notificationPresent ?? policy.notificationPresent)}
          options={notificationOptions}
          onValueChange={(next) =>
            onChange({ notificationPresent: next as AssistantProfilePatch["notificationPresent"] })
          }
        />
        <ProfileSelect
          label={t("When away")}
          value={String(value.notificationAway ?? policy.notificationAway)}
          options={notificationOptions}
          onValueChange={(next) =>
            onChange({ notificationAway: next as AssistantProfilePatch["notificationAway"] })
          }
        />
        <div className={styles.switchCell}>
          <Switch
            label={t("Task done")}
            checked={policy.observationTaskDone}
            onCheckedChange={(observationTaskDone) => onChange({ observationTaskDone })}
          />
        </div>
        <div className={styles.switchCell}>
          <Switch
            label={t("Needs input")}
            checked={policy.observationTaskNeedsInput}
            onCheckedChange={(observationTaskNeedsInput) => onChange({ observationTaskNeedsInput })}
          />
        </div>
        <div className={styles.hintRow}>
          <Text as="p" size="micro" tone="secondary" leading="inherit" className={viewStyles.muted}>
            {t("Observed tasks in projects enabled for manual supervision.")}
          </Text>
          {!observationTasksAvailable && (
            <Badge tone="warning" size="xs">
              {t("Readiness not confirmed")}
            </Badge>
          )}
        </div>
        <div className={styles.switchCell}>
          <Switch
            label={t("Keep awake while jobs run")}
            checked={value.keepAwakeWhileWorking ?? false}
            onCheckedChange={(keepAwakeWhileWorking) => onChange({ keepAwakeWhileWorking })}
          />
          {availabilityInfo}
        </div>
        <AssistantPresetNumber
          label={t("Stall timeout")}
          value={value.stallMinutes ?? 15}
          min={5}
          max={1440}
          unit={t("minutes")}
          presets={minutes([5, 15, 30, 60, 120])}
          onChange={(stallMinutes) => onChange({ stallMinutes })}
        />
      </div>
    </div>
  );
}

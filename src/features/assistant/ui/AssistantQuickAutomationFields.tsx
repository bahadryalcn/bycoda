import { useEffect, useState } from "react";
import type { AssistantQuickAutomationAction } from "../../../shared/model/assistantQuickAutomation";
import { t } from "../../../shared/i18n";
import { formatDate } from "../../../shared/i18n/core";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { NumberField } from "../../../shared/ui/NumberField";
import { Select } from "../../../shared/ui/Select";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Switch } from "../../../shared/ui/Switch";
import { ModelPicker } from "../../sessions/ui/ModelPicker";
import { defaultModelSettings, resolveModel } from "../../sessions/model/models";
import { RUNTIME_MODES, RUNTIME_MODE_LABEL } from "../../sessions/model/session";
import { REMOTE_PROVIDERS, isRemoteProvider } from "../../connections/model/protocol";
import { TimeTriggerSentence } from "../../automations/ui/TriggerEditor";
import { Text } from "../../../shared/ui/Text";
import styles from "./AssistantView.module.css";

/** One finite owner-reviewed schedule. No inheritance or Run now action. */
export function AssistantQuickAutomationFields({
  value,
  onChange,
  projects,
  disabled = false,
}: {
  value: AssistantQuickAutomationAction;
  onChange: (value: AssistantQuickAutomationAction) => void;
  projects: readonly { id: string; name: string; path: string }[];
  disabled?: boolean;
}) {
  const update = (patch: Partial<AssistantQuickAutomationAction>) => {
    if (!disabled) onChange({ ...value, ...patch });
  };
  return (
    <div className={styles.quickNoteFields}>
      <FieldGroup variant="bare" disabled={disabled}>
        <SearchableSelect
          label={t("Project")}
          value={projects.some((project) => project.id === value.projectId) ? value.projectId : ""}
          disabled={disabled}
          options={projects.map((project) => ({
            value: project.id,
            label: project.name,
            description: project.path,
          }))}
          onChange={(projectId) => update({ projectId })}
        />
        <TextField
          label={t("Automation name")}
          value={value.name}
          maxLength={200}
          onChange={(event) => update({ name: event.currentTarget.value })}
        />
        <TextareaField
          label={t("Automation prompt")}
          value={value.prompt}
          maxLength={16000}
          minRows={3}
          maxRows={10}
          onChange={(event) => update({ prompt: event.currentTarget.value })}
        />
        <div className={styles.fieldRow}>
          <FieldGroup legend={t("Execution model")} className={styles.modelField}>
            <ModelPicker
              harness={value.harness}
              model={value.model}
              values={value.modelSettings}
              allowedHarnesses={REMOTE_PROVIDERS}
              presentation="field"
              showExtras
              inheritChoice={{
                label: t("Choose a provider and model"),
                selected: !value.model,
                onSelect: () => update({ model: "", modelSettings: {} }),
              }}
              onChange={(harness, model) => {
                if (isRemoteProvider(harness))
                  update({
                    harness,
                    model,
                    modelSettings: defaultModelSettings(resolveModel(harness, model)),
                  });
              }}
              onSettingsChange={(modelSettings) => {
                if (value.model) update({ modelSettings });
              }}
            />
          </FieldGroup>
          <Select
            label={t("Execution permissions")}
            value={value.runtimeMode}
            disabled={disabled}
            options={RUNTIME_MODES.map((mode) => ({
              value: mode,
              label: t(RUNTIME_MODE_LABEL[mode]),
            }))}
            onValueChange={(runtimeMode) =>
              update({ runtimeMode: runtimeMode as AssistantQuickAutomationAction["runtimeMode"] })
            }
          />
        </div>
        <FieldGroup legend={t("Automation schedule")} className={styles.scheduleField}>
          {value.scheduleKind === "once" && value.runAt !== undefined ? (
            <Text as="p" size="micro" tone="secondary" leading="inherit" className={styles.muted}>
              {t("Runs once on {p0}, then turns itself off.", {
                p0: formatDate(value.runAt, { dateStyle: "full", timeStyle: "short" }),
              })}
            </Text>
          ) : (
            <div className={styles.scheduleRow}>
              <div className={styles.scheduleKind}>
                <Select
                  hideLabel
                  label={t("Automation schedule")}
                  value={value.scheduleKind}
                  disabled={disabled}
                  options={[
                    ["hourly", "Hourly"],
                    ["daily", "Daily"],
                    ["weekdays", "Weekdays"],
                    ["weekly", "Weekly"],
                  ].map(([id, label]) => ({ value: id, label: t(label) }))}
                  onValueChange={(scheduleKind) =>
                    update({
                      scheduleKind: scheduleKind as AssistantQuickAutomationAction["scheduleKind"],
                    })
                  }
                />
              </div>
              <Text
                as="div"
                size="secondary"
                tone="neutral"
                leading="inherit"
                className={styles.scheduleSentence}
              >
                <TimeTriggerSentence
                  trigger={
                    value as AssistantQuickAutomationAction & {
                      scheduleKind: Exclude<AssistantQuickAutomationAction["scheduleKind"], "once">;
                    }
                  }
                  nextAt={0}
                  executionTimeZone={null}
                  onChange={(next) => {
                    if (!disabled) onChange(next);
                  }}
                />
              </Text>
            </div>
          )}
        </FieldGroup>
        <div className={styles.fieldRow}>
          <Numeric
            label={t("Run time limit (minutes)")}
            value={value.maxRunMinutes}
            max={10080}
            onChange={(maxRunMinutes) => update({ maxRunMinutes })}
          />
          <Numeric
            label={t("Runs per day")}
            value={value.maxRunsPerDay}
            max={1000}
            onChange={(maxRunsPerDay) => update({ maxRunsPerDay })}
          />
        </div>
        <Text as="p" size="micro" tone="secondary" leading="inherit" className={styles.muted}>
          {t(
            "Zero means no limit. These run limits and the automation lifecycle are managed in Automations, independently of the assistant token budget.",
          )}
        </Text>
        <div className={styles.fieldRow}>
          <Switch
            label={t("Isolate each run in a worktree")}
            checked={value.isolate}
            disabled={disabled}
            onCheckedChange={(isolate) => update({ isolate })}
          />
          <Switch
            label={t("Enable this automation")}
            checked={value.enabled}
            disabled={disabled}
            onCheckedChange={(enabled) => update({ enabled })}
          />
        </div>
      </FieldGroup>
    </div>
  );
}
function Numeric({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => (Number.isFinite(value) ? String(value) : ""));
  useEffect(() => {
    if (Number.isFinite(value) && Number(draft) !== value) setDraft(String(value));
  }, [value, draft]);
  return (
    <NumberField
      label={label}
      value={draft}
      min={0}
      max={max}
      step={1}
      required
      onChange={(event) => {
        setDraft(event.currentTarget.value);
        onChange(event.currentTarget.valueAsNumber);
      }}
    />
  );
}

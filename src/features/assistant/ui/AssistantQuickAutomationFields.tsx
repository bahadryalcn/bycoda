import { useEffect, useState } from "react";
import type { AssistantQuickAutomationAction } from "../../../shared/model/assistantQuickAutomation";
import { t } from "../../../shared/i18n";
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
    <fieldset disabled={disabled} className={styles.quickNoteFields}>
      <SearchableSelect
        visibleLabel
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
        <fieldset className={styles.modelField}>
          <legend>{t("Execution model")}</legend>
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
        </fieldset>
        <Select
          visibleLabel
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
      <fieldset className={styles.scheduleField}>
        <legend>{t("Automation schedule")}</legend>
        <div className={styles.scheduleRow}>
          <div className={styles.scheduleKind}>
            <Select
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
          <div className={styles.scheduleSentence}>
            <TimeTriggerSentence
              trigger={value}
              nextAt={0}
              executionTimeZone={null}
              onChange={(next) => {
                if (!disabled) onChange(next);
              }}
            />
          </div>
        </div>
      </fieldset>
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
      <p className={styles.muted}>
        {t(
          "Zero means no limit. These run limits and the automation lifecycle are managed in Automations, independently of the assistant token budget.",
        )}
      </p>
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
    </fieldset>
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

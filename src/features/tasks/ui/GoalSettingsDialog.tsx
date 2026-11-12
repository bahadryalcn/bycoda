import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Modal } from "../../../shared/ui/Modal";
import { NumberField } from "../../../shared/ui/NumberField";
import type { BoardGoal } from "../model/goalClient";
import type { GoalSettings } from "../model/hostGoals";
import { AutoMergeField } from "./TaskFormFields";
import { TaskBudgetControls } from "./TaskBudgetControls";
import { GoalCheckOption, GoalConcurrencyOption, GoalOption, GoalSection } from "./GoalFormParts";
import type { TaskGoalsController } from "./TaskGoalsController";
import "./task-goals.css";

/** Operational edits retain the goal's plan and execution identity. */
function GoalSettingsForm({
  goal,
  saving,
  error,
  onCancel,
  onSave,
  onError,
}: {
  goal: BoardGoal;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (settings: GoalSettings) => Promise<void>;
  onError: (reason: unknown) => void;
}) {
  useLocale();
  const [settings, setSettings] = useState<GoalSettings>(() => ({
    budget: goal.budget,
    autoMerge: Boolean(goal.autoMerge),
    continueUntilDone: Boolean(goal.continueUntilDone),
    maxRunningTasks: goal.maxRunningTasks ?? 0,
    maxRunMinutes: goal.maxRunMinutes,
  }));
  const valid =
    Number.isInteger(settings.maxRunMinutes) &&
    settings.maxRunMinutes >= 0 &&
    settings.maxRunMinutes <= 10_080;
  const update = <K extends keyof GoalSettings>(key: K, value: GoalSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));
  const planning = goal.status === "planning";
  return (
    <Text
      as="form"
      size="secondary"
      tone="inherit"
      aria-label={t("Edit goal settings")}
      className="task-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving && valid) onSave(settings).catch(onError);
      }}
    >
      <div className="task-form-body">
        <Text as="p" size="inherit" tone="inherit" weight="medium" className="break-words">
          {goal.title}
        </Text>
        <Text as="p" size="micro" tone="secondary" leading="inherit" className="task-form-hint">
          {t(
            "Applies to existing unfinished tasks. Delivery requires approval of the reviewed source and target.",
          )}
        </Text>
        <FieldGroup variant="bare" disabled={saving}>
          <div className="goal-form-sections mt-3 min-w-0">
            <GoalSection title={t("How it runs")}>
              <GoalCheckOption
                title={t("Continue until complete")}
                description={t(
                  "Keeps correcting while progress is made; asks for input when needed.",
                )}
                checked={settings.continueUntilDone}
                onChange={(checked) => update("continueUntilDone", checked)}
              />
              <GoalConcurrencyOption
                value={settings.maxRunningTasks}
                onChange={(value) => update("maxRunningTasks", value)}
              />
            </GoalSection>
            <GoalSection title={t("Review and delivery")} framed={false}>
              <AutoMergeField
                checked={settings.autoMerge}
                disabled={goal.isolate === false}
                onChange={(value) => update("autoMerge", value)}
              />
            </GoalSection>
            <GoalSection title={t("Limits")} framed={false}>
              <TaskBudgetControls
                budget={settings.budget}
                onChange={(budget) => update("budget", budget ?? {})}
              />
              <GoalOption
                title={t("Run limit (minutes)")}
                description={t(
                  "Zero disables the run limit. Limits apply to waiting tasks; active tasks keep their current limit. Blocked tasks still require restart.",
                )}
                reason={t("Wait for planning to finish before changing the run limit.")}
                disabled={planning}
              >
                <NumberField
                  hideLabel
                  label={t("Run limit (minutes)")}
                  disabled={planning}
                  min={0}
                  max={10_080}
                  step={1}
                  value={Number.isNaN(settings.maxRunMinutes) ? "" : settings.maxRunMinutes}
                  onChange={(event) =>
                    update(
                      "maxRunMinutes",
                      event.target.value === "" ? NaN : Number(event.target.value),
                    )
                  }
                />
              </GoalOption>
            </GoalSection>
          </div>
        </FieldGroup>
        {error ? (
          <Alert tone="danger" className="mt-3">
            {t(error)}
          </Alert>
        ) : null}
      </div>
      <div {...surfaceAttributes({ frame: "neutral", edge: "block-start" }, "task-form-footer")}>
        <Button variant="ghost" disabled={saving} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button variant="primary" type="submit" loading={saving} disabled={!valid}>
          {t("Save")}
        </Button>
      </div>
    </Text>
  );
}

/** Goal settings, edited on the goal's own host without replanning. */
export function GoalSettingsDialog({
  goals,
  saving,
}: {
  goals: TaskGoalsController;
  saving: boolean;
}) {
  if (!goals.editing) return null;
  return (
    <Modal
      padding="none"
      title={t("Edit goal settings")}
      scroll="none"
      onClose={() => {
        if (!saving) goals.stopEditing();
      }}
    >
      <GoalSettingsForm
        goal={goals.editing}
        saving={saving}
        error={goals.settingsError}
        onCancel={goals.stopEditing}
        onSave={goals.saveSettings}
        onError={goals.report}
      />
    </Modal>
  );
}

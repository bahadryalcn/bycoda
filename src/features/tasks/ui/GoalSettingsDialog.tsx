import { useId, useState } from "react";
import { t, useFormat, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ClampText } from "../../../shared/ui/ClampText";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Heading } from "../../../shared/ui/Heading";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Modal, ModalActions, ModalFooter } from "../../../shared/ui/Modal";
import { NumberField } from "../../../shared/ui/NumberField";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { projectDisplayName } from "../../projects/public/projectNames";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { runtimeModeLabel } from "../model/runtimeModeLabel";
import type { BoardGoal } from "../model/goalClient";
import type { GoalSettings } from "../model/hostGoals";
import { GoalConcurrencyOption, GoalContinueSwitch, TaskMoreOptions } from "./GoalFormParts";
import { TaskBudgetControls } from "./TaskBudgetControls";
import { TaskFormRow } from "./TaskFormFields";
import type { TaskGoalsController } from "./TaskGoalsController";
import { TaskModelChoiceLabel } from "./TaskModelChoiceLabel";
import { TargetChips } from "../../../shared/ui/TargetChips";

/** Operational edits retain the plan and its execution identity. */
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
  const format = useFormat();
  const formId = useId();
  const [concurrencyValid, setConcurrencyValid] = useState(true);
  const [settings, setSettings] = useState<GoalSettings>(() => ({
    budget: goal.budget,
    autoMerge: Boolean(goal.autoMerge),
    continueUntilDone: Boolean(goal.continueUntilDone),
    maxRunningTasks: goal.maxRunningTasks ?? 0,
    maxRunMinutes: goal.maxRunMinutes,
  }));
  const timeLimitValid =
    Number.isInteger(settings.maxRunMinutes) &&
    settings.maxRunMinutes >= 0 &&
    settings.maxRunMinutes <= 10_080;
  const valid = timeLimitValid && concurrencyValid;
  const update = <K extends keyof GoalSettings>(key: K, value: GoalSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));
  const planning = goal.status === "planning";
  return (
    <form
      id={formId}
      aria-label={t("Edit epic settings")}
      aria-busy={saving}
      className="task-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving && valid) onSave(settings).catch(onError);
      }}
    >
      <div className="task-form-body">
        <FieldGroup variant="bare" disabled={saving} inert={saving}>
          <div className="task-form-fields">
            <div className="flex min-w-0 items-center gap-1">
              <Heading size="section" level={3} className="min-w-0 break-words">
                {goal.title}
              </Heading>
              <InfoPopover label={t("About epic settings")}>
                {t(
                  "Applies to existing unfinished tasks. Delivery requires approval of the reviewed source and target.",
                )}
              </InfoPopover>
            </div>
            <ClampText
              as="p"
              lines={2}
              expandable={false}
              size="caption"
              tone="secondary"
              wrap="anywhere"
            >
              {goal.prompt}
            </ClampText>
            <TargetChips
              project={
                goal.projects.length
                  ? {
                      value: goal.leadProjectId,
                      options: [],
                      currentLabel: goal.projects
                        .map(({ cwd }) => projectDisplayName(cwd))
                        .join(" · "),
                    }
                  : undefined
              }
              model={
                <Text size="caption" tone="secondary">
                  {goal.modelChoice && goal.modelChoice.kind !== "fixed" ? (
                    <TaskModelChoiceLabel choice={goal.modelChoice} machineId={goal.machineId} />
                  ) : (
                    <ModelLabel harness={goal.harness} model={goal.model} />
                  )}
                </Text>
              }
              access={
                goal.harness !== "fx" ? (
                  <Text size="caption" tone="secondary">
                    {runtimeModeLabel(goal.runtimeMode)}
                  </Text>
                ) : null
              }
            />
            <Surface
              frame="pane"
              radius="row"
              dividers="pane"
              padding="sm"
              className="task-form-rows"
            >
              <GoalContinueSwitch
                checked={settings.continueUntilDone}
                onChange={(checked) => update("continueUntilDone", checked)}
              />
            </Surface>
            <TaskMoreOptions
              summary={[
                timeLimitValid &&
                  settings.maxRunMinutes > 0 &&
                  format.formatDuration(settings.maxRunMinutes * 60_000),
                settings.maxRunningTasks > 0 &&
                  `${t("Concurrent tasks in this epic")} (${format.formatNumber(settings.maxRunningTasks)})`,
                settings.budget && Object.values(settings.budget).some(Boolean) && t("Run budget"),
              ]}
            >
              <Surface
                frame="pane"
                radius="row"
                dividers="pane"
                padding="sm"
                className="task-form-rows"
              >
                <TaskFormRow
                  label={
                    <span className="inline-flex items-center gap-1">
                      {t("Run limit (minutes)")}
                      <InfoPopover>
                        {t(
                          "Zero disables the run limit. Limits apply to waiting tasks; active tasks keep their current limit. Blocked tasks still require restart.",
                        )}
                      </InfoPopover>
                    </span>
                  }
                >
                  <NumberField
                    hideLabel
                    label={t("Run limit (minutes)")}
                    disabled={planning}
                    min={0}
                    max={10_080}
                    step={1}
                    value={Number.isNaN(settings.maxRunMinutes) ? "" : settings.maxRunMinutes}
                    aria-invalid={!timeLimitValid || undefined}
                    onChange={(event) => update("maxRunMinutes", event.currentTarget.valueAsNumber)}
                  />
                </TaskFormRow>
                {planning ? (
                  <InlineMessage tone="info">
                    {t("Wait for planning to finish before changing the run limit.")}
                  </InlineMessage>
                ) : null}
                <GoalConcurrencyOption
                  value={settings.maxRunningTasks}
                  onChange={(value) => update("maxRunningTasks", value)}
                  onValidityChange={setConcurrencyValid}
                />
                <TaskBudgetControls
                  compact
                  budget={settings.budget}
                  onChange={(budget) => update("budget", budget ?? {})}
                />
              </Surface>
            </TaskMoreOptions>
          </div>
        </FieldGroup>
        {error ? <InlineError className="mt-3" details={error} /> : null}
      </div>
      <ModalFooter>
        <ModalActions
          reason={
            !timeLimitValid
              ? t("Enter a run limit between 0 and 10080 minutes.")
              : !concurrencyValid
                ? t("Enter a valid task limit.")
                : undefined
          }
        >
          <Button variant="ghost" disabled={saving} onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            loading={saving}
            disabled={!valid || saving}
          >
            {t("Save")}
          </Button>
        </ModalActions>
      </ModalFooter>
    </form>
  );
}

/** Goal settings are saved on the goal's own Host. */
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
      title={t("Edit epic settings")}
      scroll="none"
      closeDisabled={saving}
      onClose={() => {
        if (!saving) goals.stopEditing();
      }}
    >
      <GoalSettingsForm
        key={goals.editing.id}
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

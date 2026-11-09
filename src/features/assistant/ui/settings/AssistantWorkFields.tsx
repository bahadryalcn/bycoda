import { useState, type ReactNode } from "react";
import type {
  AssistantExecution,
  AssistantProfilePatch,
} from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InlineError } from "../../../../shared/ui/InlineError";
import { X } from "../../../../shared/ui/icons";
import { useModelSource } from "../../../sessions/public/modelSource";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
import { defaultModelSettings, resolveModel } from "../../../sessions/public/models";
import { isRemoteProvider, REMOTE_PROVIDERS } from "../../../connections/public/protocol";
import {
  ASSISTANT_ROLE_FIELDS,
  assistantRoleExecution,
  type AssistantExecutionRole,
} from "../../../../shared/model/assistantRoles";
import { AssistantPresetNumber } from "../AssistantProfileControls";
import { ProfileSelect } from "./ProfileControls";
import { ExecutionPermissionPicker } from "./ExecutionPermissionPicker";
import { ProfileSwitch, useProfileRows } from "./SettingsProfileRow";
import styles from "./work.module.css";
import roleStyles from "../AssistantProfileFields.module.css";

/** Autonomy, plan approval, budget, execution permissions and the four model choices. */
export function AssistantWorkFields({
  value,
  onChange,
  part = "all",
}: {
  value: AssistantProfilePatch;
  onChange: (patch: AssistantProfilePatch) => void;
  /** The settings dialog renders the job rows and the model rows as two titled groups. */
  part?: "all" | "jobs" | "models";
}) {
  const rows = useProfileRows();
  const [workerModelError, setWorkerModelError] = useState("");
  const modelSource = useModelSource();
  function changeModel(
    existing: AssistantExecution | null | undefined,
    harness: AssistantExecution["harness"],
    model: string,
  ): AssistantExecution {
    return {
      harness,
      model,
      modelSettings:
        existing?.harness === harness && existing.model === model
          ? { ...existing.modelSettings }
          : defaultModelSettings(resolveModel(harness, model)),
      runtimeMode: existing?.runtimeMode ?? value.execution?.runtimeMode ?? "supervised",
      maxRunMinutes: existing?.maxRunMinutes ?? value.execution?.maxRunMinutes ?? 60,
    };
  }
  function settingsExecution(
    existing: AssistantExecution | null | undefined,
    modelSettings: Record<string, string>,
  ) {
    if (existing?.model.trim()) {
      setWorkerModelError("");
      return { ...existing, modelSettings: { ...existing.modelSettings, ...modelSettings } };
    }
    const harness = existing?.harness ?? "codex";
    const resolved = modelSource.resolve(harness, existing?.model ?? "");
    if (
      !isRemoteProvider(resolved.harness) ||
      resolved.harness !== harness ||
      !resolved.id.trim() ||
      !modelSource.available(resolved.harness) ||
      !modelSource
        .modelsFor(resolved.harness)
        .some((model) => model.harness === resolved.harness && model.id === resolved.id)
    ) {
      setWorkerModelError(t("Choose an available model before changing its settings."));
      return null;
    }
    setWorkerModelError("");
    return {
      ...changeModel(existing, resolved.harness, resolved.id),
      modelSettings: {
        ...defaultModelSettings(resolved),
        ...existing?.modelSettings,
        ...modelSettings,
      },
    };
  }
  /** Optional roles show the worker model until the owner picks one; the reset (x) restores that. */
  function roleRow(role: AssistantExecutionRole, label: string, hint: string) {
    const field = ASSISTANT_ROLE_FIELDS[role];
    const selected = value[field];
    const effective = assistantRoleExecution(value, role);
    return (
      <ModelRow
        key={role}
        label={label}
        hint={hint}
        inherited={!selected}
        onReset={selected ? () => onChange({ [field]: null }) : undefined}
      >
        <ModelPicker
          harness={effective?.harness ?? "codex"}
          model={effective?.model ?? ""}
          values={effective?.modelSettings ?? {}}
          allowedHarnesses={REMOTE_PROVIDERS}
          presentation="field"
          showExtras
          onChange={(harness, model) => {
            if (isRemoteProvider(harness)) {
              setWorkerModelError("");
              onChange({ [field]: changeModel(effective, harness, model) });
            }
          }}
          onSettingsChange={(modelSettings) => {
            const next = settingsExecution(effective, modelSettings);
            if (next) onChange({ [field]: next });
          }}
        />
      </ModelRow>
    );
  }
  function changeAutonomy(next: string) {
    if ((next === "jobs" || next === "chief") && !value.execution) {
      const resolved = modelSource.resolve("codex", "");
      if (
        resolved.harness !== "codex" ||
        !resolved.id.trim() ||
        !modelSource.available(resolved.harness) ||
        !modelSource
          .modelsFor(resolved.harness)
          .some((model) => model.harness === resolved.harness && model.id === resolved.id)
      ) {
        setWorkerModelError(t("Choose a worker model before enabling job execution."));
        return;
      }
      setWorkerModelError("");
      onChange({
        autonomy: next,
        execution: {
          harness: resolved.harness,
          model: resolved.id,
          modelSettings: defaultModelSettings(resolved),
          runtimeMode: "supervised",
          maxRunMinutes: 60,
        },
      });
      return;
    }
    setWorkerModelError("");
    onChange({ autonomy: next as AssistantProfilePatch["autonomy"] });
  }
  const permissionPicker = value.execution ? (
    <ExecutionPermissionPicker
      value={value.execution.runtimeMode}
      onChange={(runtimeMode) => onChange({ execution: { ...value.execution!, runtimeMode } })}
    />
  ) : null;
  const jobs = (
    <>
      <ProfileSelect
        label="Autonomy"
        hint="Report only observes; the other modes start work."
        value={String(value.autonomy ?? "")}
        options={[
          ["report", "Report only"],
          ["jobs", "Run jobs"],
          ["chief", "Supervise assigned jobs"],
        ]}
        onValueChange={changeAutonomy}
      />
      <ProfileSelect
        label="Plan approval"
        hint="Big jobs: four or more tasks or several projects."
        value={String(value.planApproval ?? "")}
        options={[
          ["always", "Always"],
          ["large", "Big jobs only"],
          ["never", "Never"],
        ]}
        onValueChange={(planApproval) =>
          onChange({ planApproval: planApproval as AssistantProfilePatch["planApproval"] })
        }
      />
      <AssistantPresetNumber
        label={t("Daily token budget")}
        value={value.dailyTokenBudget}
        min={1}
        max={1_000_000_000}
        unit={t("tokens/day")}
        presets={[
          { value: 100_000, label: `100k ${t("tokens/day")}` },
          { value: 500_000, label: `500k ${t("tokens/day")}` },
          { value: 1_000_000, label: `1m ${t("tokens/day")}` },
          { value: 5_000_000, label: `5m ${t("tokens/day")}` },
        ]}
        onChange={(dailyTokenBudget) => onChange({ dailyTokenBudget })}
      />
      <ProfileSwitch
        label={t("Confirm jobs before starting")}
        description={t("Off starts assigned jobs immediately.")}
        hintClassName={styles.hint}
        checked={value.confirmJobs === true}
        onCheckedChange={(confirmJobs) => onChange({ confirmJobs })}
      />
      <ProfileSwitch
        label={t("Answer routine worker questions")}
        description={t(
          "Never approves permissions, publishing, credentials or destructive actions.",
        )}
        hintClassName={styles.hint}
        checked={value.allowRoutineQuestions ?? false}
        onCheckedChange={(allowRoutineQuestions) => onChange({ allowRoutineQuestions })}
      />
      {permissionPicker &&
        (rows ? permissionPicker : <div className={styles.wide}>{permissionPicker}</div>)}
      {workerModelError && (
        <InlineError className={roleStyles.wide}>{workerModelError}</InlineError>
      )}
    </>
  );
  const models = (
    <>
      {part === "models" && workerModelError && <InlineError>{workerModelError}</InlineError>}
      <ModelRow label={t("Workers")} hint={t("Does the job's work.")}>
        <ModelPicker
          harness={value.execution?.harness ?? "codex"}
          model={value.execution?.model ?? ""}
          values={value.execution?.modelSettings ?? {}}
          allowedHarnesses={REMOTE_PROVIDERS}
          presentation="field"
          showExtras
          onChange={(harness, model) => {
            if (isRemoteProvider(harness)) {
              setWorkerModelError("");
              onChange({ execution: changeModel(value.execution, harness, model) });
            }
          }}
          onSettingsChange={(modelSettings) => {
            const execution = settingsExecution(value.execution, modelSettings);
            if (execution) onChange({ execution });
          }}
        />
      </ModelRow>
      {roleRow("chief", t("Supervisor"), t("Reviews progress."))}
      {roleRow("reply", t("Replies"), t("Answers you in chat."))}
      {roleRow("planning", t("Planner"), t("Splits big jobs into tasks."))}
    </>
  );
  if (part === "jobs") return jobs;
  if (part === "models") return models;
  return (
    <>
      {jobs}
      <h3 className={styles.sectionLabel}>{t("Models")}</h3>
      {models}
    </>
  );
}

/** One model choice: label, one muted hint, then the trigger. `inherited` fades the trigger and names its source. */
function ModelRow({
  label,
  hint,
  inherited = false,
  onReset,
  children,
}: {
  label: string;
  hint: string;
  inherited?: boolean;
  onReset?: () => void;
  children: ReactNode;
}) {
  if (useProfileRows())
    // Same look as a settings Row, but a fieldset so the row stays one named group.
    return (
      <fieldset className={`settings-row ${styles.modelRowSettings}`}>
        <legend className="sr-only">{label}</legend>
        <div className="settings-row-label">
          <div className="settings-row-title" aria-hidden="true">
            {label}
          </div>
          <p className="settings-description settings-help-text">{hint}</p>
        </div>
        <div className={`settings-row-control ${styles.modelControlRow}`}>
          <div className={`${styles.modelTrigger} ${inherited ? styles.inherited : ""}`}>
            {children}
          </div>
          {inherited ? (
            <span className={`${styles.hint} ${styles.inheritNote}`}>{t("Same as workers")}</span>
          ) : (
            onReset && (
              <Button iconOnly label={t("Use same as workers")} onClick={onReset}>
                <X className="icon-sm" />
              </Button>
            )
          )}
        </div>
      </fieldset>
    );
  return (
    <fieldset className={styles.modelRow}>
      <legend className={styles.label}>{label}</legend>
      <p className={styles.hint}>{hint}</p>
      <div className={styles.modelControl}>
        <div className={`${styles.modelTrigger} ${inherited ? styles.inherited : ""}`}>
          {children}
        </div>
        {inherited ? (
          <span className={`${styles.hint} ${styles.inheritNote}`}>{t("Same as workers")}</span>
        ) : (
          onReset && (
            <Button iconOnly label={t("Use same as workers")} onClick={onReset}>
              <X className="icon-sm" />
            </Button>
          )
        )}
      </div>
    </fieldset>
  );
}

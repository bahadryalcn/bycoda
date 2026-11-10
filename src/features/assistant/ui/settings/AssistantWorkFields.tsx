import { useState } from "react";
import {
  ASSISTANT_MIN_DAILY_TOKEN_BUDGET,
  type AssistantProfilePatch,
} from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { InlineError } from "../../../../shared/ui/InlineError";
import { AssistantPresetNumber } from "../AssistantProfileControls";
import { ProfileSelect } from "./ProfileControls";
import { ExecutionPermissionPicker } from "./ExecutionPermissionPicker";
import { useDefaultWorkerExecution } from "./defaultWorkerExecution";
import { ProfileSwitch, useProfileRows } from "./SettingsProfileRow";
import styles from "./work.module.css";

/**
 * The individual work controls behind the work-mode preset. `jobs` is autonomy, plan approval,
 * job confirmation and routine questions; `budget` is the daily token budget; `permissions` is
 * the execution permission picker. Models live in the model pool editor.
 */
export function AssistantWorkFields({
  value,
  onChange,
  part,
}: {
  value: AssistantProfilePatch;
  onChange: (patch: AssistantProfilePatch) => void;
  part: "jobs" | "budget" | "permissions";
}) {
  const rows = useProfileRows();
  const [workerModelError, setWorkerModelError] = useState("");
  const defaultWorker = useDefaultWorkerExecution();
  function changeAutonomy(next: string) {
    if ((next === "jobs" || next === "chief") && !value.execution) {
      const execution = defaultWorker();
      if (!execution) {
        setWorkerModelError(t("Choose a worker model before enabling job execution."));
        return;
      }
      setWorkerModelError("");
      onChange({ autonomy: next, execution });
      return;
    }
    setWorkerModelError("");
    onChange({ autonomy: next as AssistantProfilePatch["autonomy"] });
  }
  if (part === "budget")
    return (
      <AssistantPresetNumber
        label={t("Daily token budget")}
        value={value.dailyTokenBudget}
        min={ASSISTANT_MIN_DAILY_TOKEN_BUDGET}
        description={t(
          "Covers chat and voice replies, supervisor reviews and the jobs the assistant starts. Your own sessions are not counted. At 80% it only reports; at 100% it pauses. Minimum 20,000.",
        )}
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
    );
  if (part === "permissions") {
    if (!value.execution) return null;
    const picker = (
      <ExecutionPermissionPicker
        value={value.execution.runtimeMode}
        onChange={(runtimeMode) => onChange({ execution: { ...value.execution!, runtimeMode } })}
      />
    );
    return rows ? picker : <div className={styles.wide}>{picker}</div>;
  }
  return (
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
      {workerModelError && <InlineError className={styles.wide}>{workerModelError}</InlineError>}
    </>
  );
}

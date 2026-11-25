import { useState } from "react";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { InlineError } from "../../../../shared/ui/InlineError";
import { RadioGroup } from "../../../../shared/ui/RadioGroup";
import {
  ASSISTANT_WORK_PRESETS,
  assistantWorkPresetText,
  applyAssistantWorkPreset,
  assistantWorkPreset,
  type AssistantWorkPreset,
} from "../../model/assistantWorkPresets";
import { useDefaultWorkerExecution } from "./defaultWorkerExecution";
import { ProfileRow, useProfileRows } from "./SettingsProfileRow";
import styles from "./work.module.css";

const PRESETS = ["watch", "ask", "free"] as const satisfies readonly AssistantWorkPreset[];

/**
 * One answer to "how freely may the assistant work?". Picking a preset sets the job controls
 * together. A profile that matches no preset shows "Custom" and keeps its own choices until a
 * preset replaces them. A first setup preselects "Only watch" before this renders.
 */
export function AssistantWorkModeField({
  value,
  onChange,
}: {
  value: AssistantProfilePatch;
  onChange: (patch: AssistantProfilePatch) => void;
}) {
  const rows = useProfileRows();
  const defaultWorker = useDefaultWorkerExecution();
  const [problem, setProblem] = useState("");
  const current = assistantWorkPreset(value);
  function choose(name: string) {
    if (!PRESETS.includes(name as AssistantWorkPreset)) return;
    const preset = name as AssistantWorkPreset;
    const patch = applyAssistantWorkPreset(value, preset);
    const mode = ASSISTANT_WORK_PRESETS[preset];
    if (mode.autonomy !== "report" && !value.execution) {
      const execution = defaultWorker(mode.runtimeMode);
      if (!execution) {
        setProblem(t("Choose a worker model before enabling job execution."));
        return;
      }
      patch.execution = execution;
    }
    setProblem("");
    onChange(patch);
  }
  const showCustom = current === "custom";
  // The group or setup step above already says "Work mode"; the row asks the question instead.
  const label = t("Work mode");
  const control = (
    <>
      <RadioGroup
        label={<span className="sr-only">{label}</span>}
        compact
        className={styles.fill}
        value={current}
        onValueChange={choose}
        options={[
          ...PRESETS.map((name) => ({
            value: name,
            label: assistantWorkPresetText(name).label,
            description: assistantWorkPresetText(name).description,
          })),
          ...(showCustom
            ? [
                {
                  value: "custom",
                  label: t("Custom"),
                  description: t("Your own mix of job settings. Pick a preset to replace it."),
                },
              ]
            : []),
        ]}
      />
      {problem && <InlineError>{problem}</InlineError>}
    </>
  );
  if (rows)
    return (
      <ProfileRow label={t("How freely may it work?")} stacked>
        {() => <div className={styles.fill}>{control}</div>}
      </ProfileRow>
    );
  return control;
}

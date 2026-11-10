import { useState } from "react";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { InlineError } from "../../../../shared/ui/InlineError";
import { RadioGroup } from "../../../../shared/ui/RadioGroup";
import {
  ASSISTANT_WORK_PRESETS,
  ASSISTANT_WORK_PRESET_TEXT,
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
 * preset replaces them. `unchosen` leaves every option unselected (first setup) instead of
 * showing "Custom" for the untouched defaults.
 */
export function AssistantWorkModeField({
  value,
  onChange,
  unchosen = false,
}: {
  value: AssistantProfilePatch;
  onChange: (patch: AssistantProfilePatch) => void;
  unchosen?: boolean;
}) {
  const rows = useProfileRows();
  const defaultWorker = useDefaultWorkerExecution();
  const [error, setError] = useState("");
  const current = assistantWorkPreset(value);
  function choose(name: string) {
    if (!PRESETS.includes(name as AssistantWorkPreset)) return;
    const preset = name as AssistantWorkPreset;
    const patch = applyAssistantWorkPreset(value, preset);
    const mode = ASSISTANT_WORK_PRESETS[preset];
    if (mode.autonomy !== "report" && !value.execution) {
      const execution = defaultWorker(mode.runtimeMode);
      if (!execution) {
        setError(t("Choose a worker model before enabling job execution."));
        return;
      }
      patch.execution = execution;
    }
    setError("");
    onChange(patch);
  }
  const showCustom = current === "custom" && !unchosen;
  // The group or setup step above already says "Work mode"; the row asks the question instead.
  const label = t("Work mode");
  const control = (
    <>
      <RadioGroup
        label={<span className="sr-only">{label}</span>}
        compact
        className={styles.fill}
        value={unchosen && current === "custom" ? "" : current}
        onValueChange={choose}
        options={[
          ...PRESETS.map((name) => ({
            value: name,
            label: t(ASSISTANT_WORK_PRESET_TEXT[name].label),
            description: t(ASSISTANT_WORK_PRESET_TEXT[name].description),
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
      {error && <InlineError>{error}</InlineError>}
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

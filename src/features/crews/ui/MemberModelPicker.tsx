import { ModelPicker } from "../../sessions/ui/ModelPicker";
import { defaultModelSettings, resolveModel } from "../../sessions/model/models";
import { isRemoteProvider, REMOTE_PROVIDERS } from "../../connections/model/protocol";
import type { CrewCandidate } from "../model/crew";

/**
 * One crew member's provider, model and model options (reasoning, fast mode
 * and the rest the model offers), through the app's own model picker.
 */
export function MemberModelPicker({
  cwd,
  value,
  onChange,
}: {
  cwd: string;
  value?: CrewCandidate;
  onChange: (candidate: CrewCandidate) => void;
}) {
  return (
    <ModelPicker
      harness={value?.harness ?? "claude"}
      model={value?.model ?? ""}
      values={value?.modelSettings ?? {}}
      project={cwd}
      allowedHarnesses={REMOTE_PROVIDERS}
      onChange={(harness, model) => {
        if (!isRemoteProvider(harness)) return;
        const id = `${harness}/${model}`;
        // A new model starts from its own defaults; owner estimates belong to the old one.
        onChange(
          value?.id === id
            ? value
            : {
                id,
                harness,
                model,
                modelSettings: defaultModelSettings(resolveModel(harness, model)),
                capabilities: {},
              },
        );
      }}
      onSettingsChange={(modelSettings) => {
        if (value) onChange({ ...value, modelSettings });
      }}
    />
  );
}

import { lazy, Suspense, useState } from "react";
import { parseGitGenerationChoice } from "../model/gitGenerationPreferences";
const ModelPicker = lazy(() =>
  import("../../sessions")
    .then((entry) => entry.loadModelPicker())
    .then((module) => ({
      default: module.ModelPicker,
    })),
);
import { defaultModelId, mergeModelSettings, resolveModel } from "../../sessions/public/models";
import { HARNESSES, type HarnessId } from "../../sessions";
import {
  pickTextHarness,
  automaticGitChoice,
  type GitGenerationChoice,
} from "../model/gitGenerationChoice";

import { canRunHarnessTextPrompt } from "../../../integrations/harness";
import { LoadingText } from "../../../shared/ui/LoadingText";

const KEY = "bycoda.gitGeneration.v1:";
function load(cwd: string): GitGenerationChoice | undefined {
  try {
    return parseGitGenerationChoice(localStorage.getItem(KEY + cwd));
  } catch {
    return;
  }
}

export function useGitGenerationChoice(cwd: string) {
  const [saved, setSaved] = useState(() => ({ cwd, choice: load(cwd) }));
  if (saved.cwd !== cwd) setSaved({ cwd, choice: load(cwd) });
  const choice = saved.cwd === cwd ? saved.choice : load(cwd);
  const update = (next: GitGenerationChoice | undefined) => {
    setSaved({ cwd, choice: next });
    try {
      if (next) localStorage.setItem(KEY + cwd, JSON.stringify(next));
      else localStorage.removeItem(KEY + cwd);
    } catch {
      /* unavailable storage */
    }
  };
  return [choice, update, !!choice] as const;
}

export function GitGenerationModelControl({
  cwd,
  preferred,
  choice,
  onChange,
  disabled = false,
}: {
  cwd?: string;
  preferred?: HarnessId;
  choice?: GitGenerationChoice;
  onChange: (choice: GitGenerationChoice) => void;
  disabled?: boolean;
}) {
  const automatic = automaticGitChoice(preferred);
  const harness = choice?.harness ?? pickTextHarness(preferred);
  const model = resolveModel(harness, choice?.model ?? automatic?.model ?? defaultModelId(harness));
  const values = mergeModelSettings(model, choice?.modelSettings ?? automatic?.modelSettings);
  return (
    <Suspense fallback={<LoadingText />}>
      <ModelPicker
        harness={harness}
        model={model.id}
        values={values}
        project={cwd}
        allowedHarnesses={HARNESSES.filter(canRunHarnessTextPrompt)}
        showEffortSummary
        extrasDisabled={disabled}
        onChange={(nextHarness, nextModel) => {
          if (disabled) return;
          const resolved = resolveModel(nextHarness, nextModel);
          onChange({
            harness: nextHarness,
            model: resolved.id,
            modelSettings: mergeModelSettings(
              resolved,
              nextHarness === harness ? values : undefined,
            ),
          });
        }}
        onSettingsChange={(modelSettings) => {
          if (!disabled) onChange({ harness, model: model.id, modelSettings });
        }}
      />
    </Suspense>
  );
}

import type { HarnessId } from "../../sessions/model/session";
import { isHarnessAvailable } from "../../../integrations/harness/core/availabilityState";
import {
  modelsFor,
  nativeModelId,
  defaultModelSettings,
  modelEffortSetting,
} from "../../sessions/model/models";

export const TEXT_HARNESSES: HarnessId[] = ["claude", "cursor", "codex", "grok", "opencode"];
export type GitGenerationChoice = {
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
};

export function pickTextHarness(preferred?: HarnessId): HarnessId {
  const ordered =
    preferred && TEXT_HARNESSES.includes(preferred)
      ? [preferred, ...TEXT_HARNESSES.filter((id) => id !== preferred)]
      : TEXT_HARNESSES;
  return (
    ordered.find(isHarnessAvailable) ??
    (preferred && TEXT_HARNESSES.includes(preferred) ? preferred : "cursor")
  );
}

/** Economy presets within the configured provider, without switching accounts.
 * Catalogs don't report prices/token forecasts, so this is a small-model policy,
 * not a claim to have measured the cheapest possible request. */
export function automaticGitChoice(preferred?: HarnessId): GitGenerationChoice | undefined {
  const harness = pickTextHarness(preferred);
  const candidates = modelsFor(harness);
  const economical = [/haiku.*4[.-]5/i, /haiku/i, /luna|nano/i, /mini|flash/i, /auto/i];
  const model =
    economical.flatMap((pattern) =>
      candidates.filter((candidate) =>
        pattern.test(`${candidate.name} ${nativeModelId(candidate)}`),
      ),
    )[0] ?? candidates[0];
  if (!model || !nativeModelId(model)) return undefined;
  const modelSettings = defaultModelSettings(model);
  const effort = modelEffortSetting(model);
  if (effort) {
    const lowest = ["none", "minimal", "low"].find((value) =>
      effort.options.some((option) => option.value === value),
    );
    if (lowest) modelSettings[effort.id] = lowest;
  }
  for (const setting of model.settings ?? []) {
    const value =
      setting.id === "advisor"
        ? "off"
        : setting.id === "fast" || setting.id === "thinking"
          ? "false"
          : setting.id === "subagentModel"
            ? "default"
            : setting.id === "serviceTier"
              ? "auto"
              : undefined;
    if (value && setting.options.some((option) => option.value === value))
      modelSettings[setting.id] = value;
  }
  return { harness, model: model.id, modelSettings };
}

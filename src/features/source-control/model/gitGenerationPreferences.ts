import { useMemo, useSyncExternalStore } from "react";
import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { mergeModelSettings, resolveModel } from "../../sessions/model/models";
import { TEXT_HARNESSES, type GitGenerationChoice } from "./gitGenerationChoice";

export function parseGitGenerationChoice(raw: string | null): GitGenerationChoice | undefined {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || !TEXT_HARNESSES.includes(value.harness) || typeof value.model !== "string")
      return;
    const model = resolveModel(value.harness, value.model);
    const settings = Object.fromEntries(
      Object.entries(value.modelSettings ?? {}).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
    return {
      harness: value.harness,
      model: model.id,
      modelSettings: mergeModelSettings(model, settings),
    };
  } catch {
    return;
  }
}

const defaults = createStoredSetting<string | null>({
  key: "bycoda.gitGeneration.default.v1",
  fallback: null,
  parse: (raw) => raw,
  serialize: (raw) => raw ?? "null",
  event: "bycoda:git-generation-default",
  storageEvents: true,
});

export function saveDefaultGitGenerationChoice(choice: GitGenerationChoice | undefined) {
  defaults.save(choice ? JSON.stringify(choice) : null);
}

export function useDefaultGitGenerationChoice() {
  const raw = useSyncExternalStore(defaults.subscribe, defaults.load, () => null);
  return useMemo(() => parseGitGenerationChoice(raw), [raw]);
}

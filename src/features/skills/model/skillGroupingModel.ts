import { t } from "../../../shared/i18n";
import { useSyncExternalStore } from "react";
import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { HARNESSES } from "../../sessions/public/session";
import { modelsFor, isModelEnabled, modelBelongsToHarness } from "../../sessions/public/models";
import {
  titleGenerationChoice,
  type TitleGenerationChoice,
} from "../../sessions/public/titlePreferences";
import { parseTranslationChoice } from "../../sessions/public/translationPreferences";
import { canRunHarnessTextPrompt } from "../../../integrations/harness/core/registry";
export type SkillGroupingModel = TitleGenerationChoice;
export const SKILL_GROUPING_MODEL_KEY = "bycoda.skillGroupingModel.v1";
const preference = createStoredSetting<string | null>({
  key: SKILL_GROUPING_MODEL_KEY,
  fallback: null,
  parse: (raw) => raw,
  serialize: (raw) => raw ?? "null",
  event: "bycoda:skill-grouping-model",
  storageEvents: true,
});
export function getSkillGroupingModel(): SkillGroupingModel | undefined {
  return parseTranslationChoice(preference.load()) ?? titleGenerationChoice();
}
export function setSkillGroupingModel(choice: SkillGroupingModel | undefined): void {
  if (
    choice &&
    (!isModelEnabled(choice.model) ||
      !modelBelongsToHarness(choice.harness, choice.model) ||
      !canRunHarnessTextPrompt(choice.harness))
  )
    throw new Error(t("Choose an available skill grouping model"));
  const raw = JSON.stringify(choice ?? null);
  localStorage.setItem(SKILL_GROUPING_MODEL_KEY, raw);
  if (localStorage.getItem(SKILL_GROUPING_MODEL_KEY) !== raw)
    throw new Error(t("Could not save changes"));
  window.dispatchEvent(new Event("bycoda:skill-grouping-model"));
}
export function useSkillGroupingModel(): SkillGroupingModel | undefined {
  useSyncExternalStore(preference.subscribe, preference.load, () => null);
  return getSkillGroupingModel();
}
export function listSkillGroupingModels() {
  return HARNESSES.filter(canRunHarnessTextPrompt).flatMap((harness) =>
    modelsFor(harness)
      .filter((model) => isModelEnabled(model.id))
      .map((model) => ({ harness, model: model.id, name: model.name })),
  );
}

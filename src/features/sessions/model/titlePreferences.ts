import { useMemo, useSyncExternalStore } from "react";
import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { defaultSessionChoice, defaultModelSettings, isModelEnabled, modelsFor } from "./models";
import type { HarnessId } from "./session";
import { parseTranslationChoice, type TranslationChoice } from "./translationPreferences";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";

export type TitleGenerationChoice = TranslationChoice;
export const TITLE_CHOICE_KEY = "bycoda.title.default.v1";
const preference = createStoredSetting<string | null>({
  key: TITLE_CHOICE_KEY,
  fallback: null,
  parse: (raw) => raw,
  serialize: (raw) => raw ?? "null",
  event: "bycoda:title-default",
  storageEvents: true,
});

export function loadDefaultTitleChoice(): TitleGenerationChoice | undefined {
  return parseTranslationChoice(preference.load());
}

/** Report failed writes instead of presenting a preference that was never saved. */
export function saveDefaultTitleChoice(choice: TitleGenerationChoice | undefined): void {
  const serialized = JSON.stringify(choice ?? null);
  localStorage.setItem(TITLE_CHOICE_KEY, serialized);
  if (localStorage.getItem(TITLE_CHOICE_KEY) !== serialized)
    throw new Error("Could not save changes");
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("bycoda:title-default"));
}

export function useDefaultTitleChoice() {
  const raw = useSyncExternalStore(preference.subscribe, preference.load, () => null);
  return useMemo(() => parseTranslationChoice(raw), [raw]);
}

/** Match actual enabled catalog entries; never substitute an expensive conversation model. */
export function defaultTitleChoice(
  harness: HarnessId = defaultSessionChoice().harness,
): TitleGenerationChoice | undefined {
  const catalog = modelsFor(harness).filter((model) => isModelEnabled(model.id));
  const preferred =
    harness === "codex" ? /terra/i : harness === "claude" ? /haiku/i : /flash|haiku|terra/i;
  const label = (model: (typeof catalog)[number]) =>
    `${model.id} ${model.nativeId ?? ""} ${model.name}`;
  const model =
    catalog.find((entry) => preferred.test(label(entry))) ??
    catalog.find((entry) => /luna|mini|nano|lite|flash|haiku|terra/i.test(label(entry)));
  if (!model) return;
  const modelSettings = defaultModelSettings(model);
  for (const setting of model.settings ?? []) {
    if (/effort|reasoning/i.test(setting.id)) {
      const low = ["none", "minimal", "low"].find((value) =>
        setting.options.some((option) => option.value === value),
      );
      if (low) modelSettings[setting.id] = low;
    }
    if (/advisor/i.test(setting.id) && setting.options.some((option) => option.value === "off"))
      modelSettings[setting.id] = "off";
  }
  return {
    harness,
    model: model.id,
    modelSettings,
    providerAccountId: supportsProviderAccounts(harness)
      ? defaultProviderAccountId(harness)
      : undefined,
  };
}

export function titleGenerationChoice(harness?: HarnessId): TitleGenerationChoice | undefined {
  const choice = loadDefaultTitleChoice() ?? defaultTitleChoice(harness);
  if (!choice) return;
  return {
    ...choice,
    providerAccountId: supportsProviderAccounts(choice.harness)
      ? (choice.providerAccountId ?? defaultProviderAccountId(choice.harness))
      : undefined,
  };
}

import { resolveHelperModel } from "../../model-routing/public/helpers";
import { defaultSessionChoice, defaultModelSettings, isModelEnabled, modelsFor } from "./models";
import type { HarnessId } from "./session";
import { type TranslationChoice } from "./translationPreferences";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";

export type TitleGenerationChoice = TranslationChoice;
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
  const choice = defaultTitleChoice(harness);
  if (!choice) return;
  return {
    ...choice,
    providerAccountId: supportsProviderAccounts(choice.harness)
      ? (choice.providerAccountId ?? defaultProviderAccountId(choice.harness))
      : undefined,
  };
}

export async function resolveTitleGenerationChoice(harness?: HarnessId, cwd?: string) {
  return (
    (await resolveHelperModel("text.title", {
      cwd,
    })) ?? titleGenerationChoice(harness)
  );
}

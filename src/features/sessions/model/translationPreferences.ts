import { useMemo, useSyncExternalStore } from "react";
import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { HARNESSES } from "./session";
import type { TranslationContext } from "./translation";
import { defaultSessionChoice, preferredModelSettings, resolveModel } from "./models";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";

export type TranslationChoice = Required<Pick<TranslationContext, "harness" | "model">> &
  Pick<TranslationContext, "modelSettings" | "providerAccountId">;

/** The same global default shown in Settings, independent of the calling conversation. */
export function defaultTextActionChoice(): TranslationChoice {
  const choice = defaultSessionChoice();
  return {
    ...choice,
    modelSettings: preferredModelSettings(resolveModel(choice.harness, choice.model)),
    providerAccountId: supportsProviderAccounts(choice.harness)
      ? defaultProviderAccountId(choice.harness)
      : undefined,
  };
}

export function parseTranslationChoice(raw: string | null): TranslationChoice | undefined {
  try {
    const value = JSON.parse(raw ?? "null");
    if (
      !value ||
      !HARNESSES.includes(value.harness) ||
      typeof value.model !== "string" ||
      !value.model.trim()
    )
      return;
    return {
      harness: value.harness,
      model: value.model,
      modelSettings: Object.fromEntries(
        Object.entries(value.modelSettings ?? {}).filter(([, entry]) => typeof entry === "string"),
      ) as Record<string, string>,
      providerAccountId:
        typeof value.providerAccountId === "string" ? value.providerAccountId : undefined,
    };
  } catch {
    return;
  }
}

const defaults = createStoredSetting<string | null>({
  key: "bycoda.translation.default.v1",
  fallback: null,
  parse: (raw) => raw,
  serialize: (raw) => raw ?? "null",
  event: "bycoda:translation-default",
  storageEvents: true,
});

const repromptDefaults = createStoredSetting<string | null>({
  key: "bycoda.reprompt.default.v1",
  fallback: null,
  parse: (raw) => raw,
  serialize: (raw) => raw ?? "null",
  event: "bycoda:reprompt-default",
  storageEvents: true,
});

export function saveDefaultRepromptChoice(choice: TranslationChoice | undefined) {
  repromptDefaults.save(choice ? JSON.stringify(choice) : null);
}

export function loadDefaultRepromptChoice() {
  return parseTranslationChoice(repromptDefaults.load());
}

export function useDefaultRepromptChoice() {
  const raw = useSyncExternalStore(repromptDefaults.subscribe, repromptDefaults.load, () => null);
  return useMemo(() => parseTranslationChoice(raw), [raw]);
}

export function saveDefaultTranslationChoice(choice: TranslationChoice | undefined) {
  defaults.save(choice ? JSON.stringify(choice) : null);
}

export function loadDefaultTranslationChoice() {
  return parseTranslationChoice(defaults.load());
}

export function useDefaultTranslationChoice() {
  const raw = useSyncExternalStore(defaults.subscribe, defaults.load, () => null);
  return useMemo(() => parseTranslationChoice(raw), [raw]);
}

/** Keep execution on the calling session's machine and project. */
export function translationContextWithDefault(
  context: TranslationContext,
  action: "translation" | "reprompt" = "translation",
): TranslationContext {
  const choice =
    (action === "reprompt" ? loadDefaultRepromptChoice() : loadDefaultTranslationChoice()) ??
    defaultTextActionChoice();
  return {
    ...context,
    ...choice,
    // A conversation account is a separate pin; an unpinned action uses the provider default.
    providerAccountId: supportsProviderAccounts(choice.harness)
      ? (choice.providerAccountId ?? defaultProviderAccountId(choice.harness))
      : undefined,
  };
}

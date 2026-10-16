import { useMemo, useSyncExternalStore } from "react";
import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { HARNESSES } from "./session";
import type { TranslationContext } from "./translation";

export type TranslationChoice = Required<Pick<TranslationContext, "harness" | "model">> &
  Pick<TranslationContext, "modelSettings" | "providerAccountId">;

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
export function translationContextWithDefault(context: TranslationContext): TranslationContext {
  const choice = loadDefaultTranslationChoice();
  if (!choice) return context;
  // A session account only applies to the same harness; an explicit choice account always wins.
  const { providerAccountId, ...rest } = choice;
  const account =
    providerAccountId ??
    (choice.harness === context.harness ? context.providerAccountId : undefined);
  return { ...context, ...rest, providerAccountId: account };
}

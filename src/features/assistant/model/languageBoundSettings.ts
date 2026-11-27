import { t } from "../../../shared/i18n";

/** Settings whose text was written in the assistant's spoken language. */
export type LanguageBoundKey =
  | "persona"
  | "addressAs"
  | "wakePhrase"
  | "sleepPhrase"
  | "dictationDictionary"
  | "dictationLanguage";

/** The profile fields this detection reads. */
type ProfileLike = { persona?: string; addressAs?: string };

/** The voice settings this detection reads (structurally a subset of `VoiceSettings`). */
export type VoiceLanguageSettings = {
  wakePhrase?: string;
  sleepPhrase?: string;
  dictationDictionary?: readonly unknown[];
  dictationLanguage?: string;
};

export type LanguageBoundItem = { key: LanguageBoundKey; label: string };

export type LanguageChange = {
  /** Language tag the settings were written for; `null` when it is not known ("auto" before any speech). */
  from: string | null;
  /** The chosen language ("auto" included). */
  to: string;
  /** Non-empty language-bound settings, in display order. Empty means no warning. */
  items: LanguageBoundItem[];
};

/** Base language of a tag ("tr-TR" and "tr_tr" give "tr"); "auto" and blank give `null`. */
export function baseLanguage(value: string | null | undefined): string | null {
  const base = value?.trim().toLowerCase().replace(/_/g, "-").split("-")[0] ?? "";
  return base === "" || base === "auto" ? null : base;
}

/** Plain language name in the interface language; "Auto" for "auto". */
export function languageDisplayName(value: string): string {
  if (baseLanguage(value) === null) return t("Auto");
  try {
    return new Intl.DisplayNames([value], { type: "language" }).of(value) ?? value;
  } catch {
    return value;
  }
}

const filled = (value: string | undefined) => (value ?? "").trim() !== "";

/**
 * The language-bound settings written for the previous language when the spoken language changes.
 * `lastSpoken` stands in for a previous "auto". A change within one base language (tr to tr-TR),
 * or from "auto" to the language the owner last spoke, warns about nothing.
 */
export function languageChange({
  previous,
  next,
  lastSpoken,
  profile,
  voice,
}: {
  previous: string | undefined;
  next: string;
  lastSpoken?: string | null;
  profile: ProfileLike;
  voice?: VoiceLanguageSettings;
}): LanguageChange {
  const from = baseLanguage(previous) ? (previous as string) : lastSpoken?.trim() || null;
  const none: LanguageChange = { from, to: next, items: [] };
  const previousBase = baseLanguage(previous ?? "auto");
  const nextBase = baseLanguage(next);
  if (previousBase === nextBase) return none;
  // "auto" to a fixed language: only a change when the owner last spoke something else.
  if (previousBase === null && nextBase !== null && baseLanguage(lastSpoken) === nextBase)
    return none;
  const fromBase = baseLanguage(from);
  const items: LanguageBoundItem[] = [];
  if (filled(profile.persona)) items.push({ key: "persona", label: t("Persona") });
  if (filled(profile.addressAs))
    items.push({ key: "addressAs", label: t("How should I address you?") });
  if (filled(voice?.wakePhrase)) items.push({ key: "wakePhrase", label: t("Wake phrase") });
  if (filled(voice?.sleepPhrase)) items.push({ key: "sleepPhrase", label: t("Sleep phrase") });
  if ((voice?.dictationDictionary?.length ?? 0) > 0)
    items.push({ key: "dictationDictionary", label: t("Dictation dictionary") });
  const dictation = baseLanguage(voice?.dictationLanguage);
  if (dictation !== null && dictation !== nextBase && (fromBase === null || dictation === fromBase))
    items.push({ key: "dictationLanguage", label: t("Dictation language") });
  return { ...none, items };
}

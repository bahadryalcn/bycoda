/**
 * Shared offline language contract for desktop and mobile. `value` is the app locale;
 * `tag` is the regional tag saved by assistant profiles and interview content.
 */
export const LANGUAGES = [
  { value: "tr", tag: "tr-TR", label: "Türkçe" },
  { value: "en", tag: "en-US", label: "English" },
  { value: "de", tag: "de-DE", label: "Deutsch" },
  { value: "fr", tag: "fr-FR", label: "Français" },
  { value: "es", tag: "es-ES", label: "Español" },
  { value: "pt", tag: "pt-PT", label: "Português" },
  { value: "zh-CN", tag: "zh-CN", label: "简体中文" },
  { value: "ja", tag: "ja-JP", label: "日本語" },
] as const;
export type Locale = (typeof LANGUAGES)[number]["value"];
export type LanguagePreference = Locale | "system";
export function isLocale(value: unknown): value is Locale {
  return LANGUAGES.some((language) => language.value === value);
}
export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || isLocale(value);
}
export function resolveLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.replace(/_/g, "-").toLowerCase().split("-")[0];
    if (base === "zh") return "zh-CN";
    if (isLocale(base)) return base;
  }
  return "en";
}

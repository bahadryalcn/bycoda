/** Shared offline language contract for desktop and mobile. */
export const LANGUAGES = [
  { value: "tr", label: "Türkçe" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "zh-CN", label: "简体中文" },
  { value: "ja", label: "日本語" },
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

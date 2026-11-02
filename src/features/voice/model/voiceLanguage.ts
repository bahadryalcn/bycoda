/** An assistant's spoken language is separate from the interface language. */
export function voiceLanguageCode(language: string) {
  if (!language || language === "auto") return undefined;
  try { return Intl.getCanonicalLocales(language)[0]?.split("-")[0]; } catch { return undefined; }
}

export function voiceLanguageInstructions(language = "auto") {
  const code = voiceLanguageCode(language);
  if (!code) return "";
  const native: Record<string, string> = {
    tr: "Her zaman Türkçe konuş. Türkçeyi ana dili olan biri gibi doğal vurgu ve tonlamayla konuş.",
    en: "Always speak English.", de: "Sprich immer Deutsch.", fr: "Parle toujours français.",
    es: "Habla siempre en español.", pt: "Fale sempre em português.",
    ja: "常に日本語で話してください。", zh: "请始终使用中文交流。",
  };
  const label = new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  return `Always answer only in ${label} (${language}), even when the user speaks another language. Use the natural pronunciation and intonation of a native speaker of that language. This overrides language detection and the interface-language hint. ${native[code] ?? ""}\n`;
}

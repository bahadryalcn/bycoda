export const APPEARANCE_PREFERENCES_EVENT = "bycoda.appearancePreferencesChanged";
const KEY = "bycoda.appearancePreferences.v1";
export const INTERFACE_FONTS = ["System", "Segoe UI", "Arial", "Verdana"] as const;
export const CODE_FONTS = ["System", "Consolas", "Menlo", "Courier New"] as const;
export const APPEARANCE_DEFAULTS = {
  interfaceFont: "System",
  codeFont: "System",
  codeSize: 13,
  contrast: 100,
  chatWidth: "comfortable",
  wordWrap: false,
} as const;
export type AppearancePreferences = {
  interfaceFont: string;
  codeFont: string;
  codeSize: number;
  contrast: number;
  chatWidth: "comfortable" | "wide" | "full";
  wordWrap: boolean;
};
function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}
export function normalizeAppearancePreferences(
  value: Partial<AppearancePreferences>,
): AppearancePreferences {
  return {
    interfaceFont: INTERFACE_FONTS.includes(value.interfaceFont as (typeof INTERFACE_FONTS)[number])
      ? value.interfaceFont!
      : "System",
    codeFont: CODE_FONTS.includes(value.codeFont as (typeof CODE_FONTS)[number])
      ? value.codeFont!
      : "System",
    codeSize: bounded(value.codeSize, 13, 11, 18),
    contrast: bounded(value.contrast, 100, 75, 150),
    chatWidth:
      value.chatWidth === "wide" || value.chatWidth === "full" ? value.chatWidth : "comfortable",
    wordWrap: value.wordWrap === true,
  };
}
export function loadAppearancePreferences(): AppearancePreferences {
  try {
    return normalizeAppearancePreferences(JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {});
  } catch {
    return { ...APPEARANCE_DEFAULTS };
  }
}
export function applyAppearancePreferences(value: AppearancePreferences) {
  const root = document.documentElement;
  for (const [property, font, fallback] of [
    ["--font-sans", value.interfaceFont, "sans-serif"],
    ["--font-mono", value.codeFont, "monospace"],
  ]) {
    if (font === "System") root.style.removeProperty(property);
    else root.style.setProperty(property, `"${font}", ${fallback}`);
  }
  root.style.setProperty("--appearance-code-size", `${value.codeSize}px`);
  root.style.setProperty("--appearance-stroke-strength", `${(7 * value.contrast) / 100}%`);
  root.style.setProperty(
    "--appearance-secondary-strength",
    `${Math.min(100, (85 * value.contrast) / 100)}%`,
  );
  root.style.setProperty(
    "--appearance-chat-width",
    value.chatWidth === "full" ? "100%" : value.chatWidth === "wide" ? "76rem" : "56rem",
  );
  root.classList.toggle("appearance-word-wrap", value.wordWrap);
}
export function saveAppearancePreferences(value: AppearancePreferences) {
  const next = normalizeAppearancePreferences(value);
  localStorage.setItem(KEY, JSON.stringify(next));
  applyAppearancePreferences(next);
  window.dispatchEvent(new Event(APPEARANCE_PREFERENCES_EVENT));
  return next;
}
export function initAppearancePreferences() {
  applyAppearancePreferences(loadAppearancePreferences());
  window.addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) {
      applyAppearancePreferences(loadAppearancePreferences());
      window.dispatchEvent(new Event(APPEARANCE_PREFERENCES_EVENT));
    }
  });
}

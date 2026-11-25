import type { t as translateApp } from "../../../shared/i18n";

/**
 * Translates text that comes from the provider catalog or from the setting tables rather than from a
 * call site: the English text of a known setting is its locale key, and text the catalog invented
 * passes through unchanged. The translator is a parameter so the one place that cannot name a
 * literal key stays here.
 */
export function catalogText(translate: typeof translateApp, text: string): string {
  return translate(text);
}

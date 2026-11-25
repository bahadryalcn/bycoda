import { t } from "../../../shared/i18n";
import { normalizeNoteTags } from "../notes";

/** Stable stored values keep ready tags usable across locale changes. */
export const NOTE_TAG_PRESETS = [
  { value: "todo" },
  { value: "idea" },
  { value: "plan" },
  { value: "in-progress" },
  { value: "done" },
] as const;

/** The preset's visible name; the stored value stays the same in every language. */
export function noteTagPresetLabel(value: (typeof NOTE_TAG_PRESETS)[number]["value"]): string {
  switch (value) {
    case "todo":
      return t("To do");
    case "idea":
      return t("Idea");
    case "plan":
      return t("Plan");
    case "in-progress":
      return t("In progress");
    case "done":
      return t("Done");
  }
}

/** Library tags come first; presets fill out an empty or new library. */
export function noteTagSuggestions(
  available: readonly string[],
  selected: readonly string[],
): string[] {
  const seen = new Set(normalizeNoteTags(selected));
  const suggestions: string[] = [];
  for (const candidate of [...available, ...NOTE_TAG_PRESETS.map((preset) => preset.value)]) {
    const tag = normalizeNoteTags([candidate])[0];
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    suggestions.push(tag);
  }
  return suggestions;
}

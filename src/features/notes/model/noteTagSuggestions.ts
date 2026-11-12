import { normalizeNoteTags } from "../notes";

/** Stable stored values keep ready tags usable across locale changes. */
export const NOTE_TAG_PRESETS = [
  { value: "todo", label: "To do" },
  { value: "idea", label: "Idea" },
  { value: "plan", label: "Plan" },
  { value: "in-progress", label: "In progress" },
  { value: "done", label: "Done" },
] as const;

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

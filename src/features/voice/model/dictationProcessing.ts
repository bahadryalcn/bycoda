import type { DictationDictionaryEntry } from "./voiceSettings";
import { removeSpeechFillers } from "./voiceTranscript";

export type DictationProcessingOptions = {
  dictionary?: readonly DictationDictionaryEntry[];
  projectId?: string;
  removeFillers?: boolean;
  silenceFilter?: boolean;
  language?: string;
  correctionCue?: string;
  cleanup?: {
    enabled: boolean;
    model: string;
    instructions: string;
    correctionCue: string;
    translateToEnglish: boolean;
  };
};
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const boundary = (pattern: string) => `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`;

/** Only the newly recognized phrase is processed, never the surrounding draft. */
export function processDictationText(text: string, options: DictationProcessingOptions): string {
  const aliases = new Map<string, string>();
  const entries = (options.dictionary ?? []).filter(
    (entry) => !entry.projectId || entry.projectId === options.projectId,
  );
  // Project entries override shared entries for the same spoken alias.
  for (const entry of [
    ...entries.filter((item) => !item.projectId),
    ...entries.filter((item) => item.projectId),
  ]) {
    for (const alias of [entry.term, ...entry.aliases])
      if (alias.trim()) aliases.set(alias.trim().toLocaleLowerCase(), entry.term);
  }
  const words = [...aliases.keys()].sort((a, b) => b.length - a.length);
  let result = text;
  if (words.length) {
    result = result.replace(
      new RegExp(boundary(words.map(escapePattern).join("|")), "giu"),
      (match) => aliases.get(match.toLocaleLowerCase()) ?? match,
    );
  }
  if (options.removeFillers)
    result = removeSpeechFillers(result, {
      language: options.language,
      keep: options.correctionCue,
    });
  return result;
}

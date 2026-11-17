import { isVoiceTranscriptionHintEcho } from "./voiceFeatureLexicon";

/** Event annotations and an echoed vocabulary hint are recognizer metadata, never
 * user instructions. Keep lexical speech, including single-word replies. */
export function speechTranscript(text: string): string {
  const event =
    "(?:cough(?:ing)?|clears? throat|throat clearing|breath(?:ing)?|sigh(?:ing)?|keyboard|typing|noise|silence|music|öksürük|öksürme|boğaz temizleme|nefes|sessizlik)";
  const spoken = text
    .replace(
      new RegExp(`\\[\\s*${event}\\s*\\]|\\(\\s*${event}\\s*\\)|<\\s*${event}\\s*>`, "giu"),
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(spoken) && !isVoiceTranscriptionHintEcho(spoken) ? spoken : "";
}

// Hesitations in any language, elongations included ("hmmm", "eeee", "Iıı").
// Turkish "ee"/"ı" are no word in a supported language; a lone English "I" stays.
const FILLERS = [
  "u+h+m*",
  "u+m{2,}",
  "e+h{2,}",
  "e+hm+",
  "a+hm+",
  "h+m+",
  "m{2,}",
  "х+м+",
  "м{2,}",
  "e{2,}m*",
  "I?ı+",
];
// Short forms that are real words elsewhere ("um" in German, "e" in Italian).
const LANGUAGE_FILLERS: Record<string, string[]> = {
  en: ["um", "a+h", "e+h"],
  de: ["ä+h+m*", "ö+h?m+"],
  fr: ["eu+h+"],
  tr: ["e(?=\\s*(?:,|…|\\.{2,}))"],
};

/** Removes spoken hesitations ("eee", "ııı", "um", "hmm") as whole words with
 * their trailing comma, period or ellipsis. `keep` preserves one word, such as
 * a correction cue that happens to be a filler. */
export function removeSpeechFillers(
  text: string,
  options: { language?: string; keep?: string } = {},
): string {
  const language = options.language?.split(/[-_]/)[0]?.toLowerCase() ?? "";
  const patterns = [...FILLERS, ...(LANGUAGE_FILLERS[language] ?? [])];
  const keep = options.keep?.trim().toLocaleLowerCase();
  let removed = false;
  const result = text
    .replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}_])(?:${patterns.join("|")})(?![\\p{L}\\p{N}_])(?:\\s*(?:,|…|\\.{2,}|\\.(?=\\s|$)))?`,
        "giu",
      ),
      (match) => {
        if (keep && match.replace(/[\s,.…]+$/, "").toLocaleLowerCase() === keep) return match;
        removed = true;
        return " ";
      },
    )
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:…])/g, "$1")
    .replace(/,([.!?])/g, "$1")
    .replace(/^[\s,.;:…]+|[\s,;:]+$/g, "");
  if (!removed) return text;
  if (!result) return "";
  // Keep the sentence end a removed trailing filler carried.
  const end = /[.!?…]$/.test(text.trim()) && !/[.!?…]$/.test(result) ? "." : "";
  const first = text.match(/\p{L}/u)?.[0];
  // A removed sentence opener leaves the next word to start the sentence.
  const capital = !!first && first !== first.toLocaleLowerCase();
  return (
    (capital ? result[0]!.toLocaleUpperCase(language || undefined) + result.slice(1) : result) + end
  );
}

import { previewVoice } from "./voicePreview";
import type { VoiceSettings } from "./voiceSettings";

/** Split only at whitespace where possible; never discard or reorder content. */
export function briefingChunks(text: string, limit = 3000): string[] {
  const chunks: string[] = [];
  while (text.length > limit) {
    const boundary = text.lastIndexOf(" ", limit);
    let end = boundary > limit / 2 ? boundary + 1 : limit;
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    chunks.push(text.slice(0, end));
    text = text.slice(end);
  }
  if (text) chunks.push(text);
  return chunks;
}

/** Playback remains sequential; cancellation never starts a later chunk. */
export async function previewBriefing(
  settings: VoiceSettings,
  language: string,
  name: string,
  signal: AbortSignal,
  played: () => void,
  text: string,
  playback: (active: boolean) => void,
  options: { complete?: boolean; languageHint?: string },
) {
  for (const chunk of briefingChunks(text)) {
    if (signal.aborted) return;
    await previewVoice(settings, language, name, signal, played, chunk, playback, options);
  }
}

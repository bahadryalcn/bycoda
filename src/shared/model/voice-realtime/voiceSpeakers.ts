/** Speaker voices per engine. Realtime lists were verified live on 2026-10-31
 * (each accepted the voice and spoke); Supertonic 3 ships M1–M5 and F1–F5. */
export type SpeakerEngine = "supertonic" | "grok" | "openai";
export const SPEAKER_IDS: Record<SpeakerEngine, readonly string[]> = {
  supertonic: ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"],
  grok: ["eve", "ara", "leo", "rex", "sal"],
  openai: ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"],
};
export const DEFAULT_SPEAKERS: Record<SpeakerEngine, string> = {
  supertonic: "M1",
  grok: "eve",
  openai: "marin",
};

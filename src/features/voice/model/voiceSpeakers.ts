import { t } from "../../../shared/i18n";

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

export function speakerLabel(engine: SpeakerEngine, id: string): string {
  if (engine === "supertonic")
    return t(id.startsWith("F") ? "Female {p1}" : "Male {p1}", { p1: id.slice(1) });
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export function speakerOptions(engine: SpeakerEngine) {
  return SPEAKER_IDS[engine].map((value) => ({ value, label: speakerLabel(engine, value) }));
}

/** The engine whose speaker list applies to these settings, if any. */
export function speakerEngine(settings: {
  mode: "local" | "grok" | "openai";
  natural: boolean;
  engine: string;
}): SpeakerEngine | undefined {
  if (settings.mode !== "local") return settings.mode;
  return settings.natural && settings.engine === "supertonic" ? "supertonic" : undefined;
}

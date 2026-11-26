import { t } from "../../../shared/i18n";
import {
  DEFAULT_SPEAKERS,
  SPEAKER_IDS,
  type SpeakerEngine,
} from "../../../shared/model/voice-realtime/voiceSpeakers";

export { DEFAULT_SPEAKERS, SPEAKER_IDS, type SpeakerEngine };

export function speakerLabel(engine: SpeakerEngine, id: string): string {
  if (engine === "supertonic")
    return id.startsWith("F")
      ? t("Female {p1}", { p1: id.slice(1) })
      : t("Male {p1}", { p1: id.slice(1) });
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

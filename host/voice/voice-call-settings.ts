import {
  VoiceCallSettingsSchema,
  type VoiceCallSettings,
  type VoiceCallSettingsPatch,
  type VoiceCallSettingsResult,
} from "../../src/shared/model/host-contracts/voice";
import {
  DEFAULT_SPEAKERS,
  SPEAKER_IDS,
} from "../../src/shared/model/voice-realtime/voiceSpeakers";
import { voiceLanguageCode } from "../../src/shared/model/voice-realtime/voiceLanguage";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";

export const DEFAULT_VOICE_CALL_SETTINGS: VoiceCallSettings = Object.freeze({
  mode: "local",
  grokVoice: DEFAULT_SPEAKERS.grok,
  openaiVoice: DEFAULT_SPEAKERS.openai,
  languageLock: "auto",
  persona: "",
  turnEndSilence: 1.2,
});

/** A speaker or language the Host does not know is refused before anything is written. */
function validate(settings: VoiceCallSettings): VoiceCallSettings {
  const parsed = VoiceCallSettingsSchema.parse(settings);
  if (!SPEAKER_IDS.grok.includes(parsed.grokVoice)) throw new Error("Unknown Grok Voice speaker.");
  if (!SPEAKER_IDS.openai.includes(parsed.openaiVoice))
    throw new Error("Unknown OpenAI Realtime speaker.");
  if (parsed.languageLock !== "auto" && !voiceLanguageCode(parsed.languageLock))
    throw new Error("Unknown call language.");
  return { ...parsed, persona: parsed.persona.trim() };
}

/**
 * How a phone call talks: on-computer recognition and speech (`local`) or a realtime voice relayed
 * by this computer. One file per Host; it holds choices only, never keys, model ids or paths.
 */
export class VoiceCallSettingsStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly path: string,
    private readonly signedIn: () => Promise<VoiceCallSettingsResult["signedIn"]>,
  ) {}

  /** A missing or damaged file reads as the defaults; a damaged one is kept as evidence. */
  async read(): Promise<VoiceCallSettings> {
    const result = await readStateFile(this.path, (text) => validate(JSON.parse(text)));
    return result.status === "ok" ? result.value : { ...DEFAULT_VOICE_CALL_SETTINGS };
  }

  async get(): Promise<VoiceCallSettingsResult> {
    const [settings, signedIn] = await Promise.all([this.read(), this.signedIn()]);
    return { settings, signedIn };
  }

  /** Writes are serialized so two quick changes from the phone cannot lose one another. */
  set(patch: VoiceCallSettingsPatch): Promise<VoiceCallSettingsResult> {
    const run = this.queue.then(async () => {
      const next = validate({ ...(await this.read()), ...patch });
      await writeFileAtomic(this.path, `${JSON.stringify(next, null, 2)}\n`);
    });
    this.queue = run.catch(() => undefined);
    return run.then(() => this.get());
  }
}

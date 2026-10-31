// Synthetic transport for the voice fixture. No device, Host, provider or audio access.
export const fixtureVoice = { callbacks: null as any, connects: 0, closes: 0 };
export class LocalVoice {
  readonly level = { current: 0.55 };
  constructor(callbacks: any, _language?: string, _config?: unknown, level = this.level) {
    this.level = level;
    this.level.current = 0.55;
    fixtureVoice.callbacks = callbacks;
  }
  async connect() {
    fixtureVoice.connects++;
    if (new URLSearchParams(location.search).get("state") === "connecting")
      await new Promise(() => {});
  }
  close() {
    fixtureVoice.closes++;
  }
  speak() {
    return true;
  }
  mute() {}
  silence() {
    fixtureVoice.callbacks?.playback(false);
  }
}
export const sessionsRef = { current: [] };
export const useSession = () => undefined;
export const converseWithSession = () => new Promise(() => {});
export const warmVoiceReply = async () => {};
export const localVoiceBackend = {
  inspect: async () => ({
    ready: true,
    missing: [],
    python: "/fixture/python",
    whisperPath: "/fixture/whisper",
    ttsPath: "/fixture/tts",
  }),
  setupStatus: async () => ({ state: "idle" }),
  cloudStatus: async () => ({ elevenlabs: false }),
};

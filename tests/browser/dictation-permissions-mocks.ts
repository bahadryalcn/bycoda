// Fixture transport only. No Host, provider, recognizer or real microphone access.
export * from "./voice-visual-styles-mocks";
import { LocalVoice as FixtureLocalVoice } from "./voice-visual-styles-mocks";
import { microphoneBlockedMessage } from "../../src/features/voice/model/microphoneAccess";

export class LocalVoice extends FixtureLocalVoice {
  override async connect() {
    if (new URLSearchParams(location.search).has("voice-denied"))
      throw new Error(microphoneBlockedMessage());
    return super.connect();
  }
}

export const fixtureDictation = {
  inspected: [] as unknown[],
  installed: [] as unknown[],
  starts: [] as unknown[],
  releases: 0,
  microphoneRequests: 0,
  microphoneStops: 0,
  microphoneResult: "denied" as "denied" | "allowed" | "missing" | "busy",
};

export const localVoiceBackend = {
  inspect: async (config: unknown) => {
    fixtureDictation.inspected.push(config);
    return { ready: true, missing: [], python: "/fixture/python", whisperPath: "/fixture/whisper" };
  },
  setup: async (config: unknown) => {
    fixtureDictation.installed.push(config);
    return { state: "ready", config, requestedConfig: config };
  },
  setupStatus: async () => ({ state: "idle" }),
  cloudStatus: async () => ({ elevenlabs: false }),
  start: async (config: unknown, recognitionOnly: boolean) => {
    fixtureDictation.starts.push({ config, recognitionOnly });
    return { lease: "synthetic-dictation", model: "fixture", device: "cpu" };
  },
  release: async () => {
    fixtureDictation.releases++;
  },
  keepAlive: async () => ({ ready: true }),
};

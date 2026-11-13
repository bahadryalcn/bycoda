// Fixture transport only. No Host, provider, recognizer or real microphone access.
export * from "./voice-visual-styles-mocks";
import { LocalVoice as FixtureLocalVoice } from "./voice-visual-styles-mocks";
import { microphoneBlockedMessage } from "../../../src/features/voice/model/microphoneAccess";

export const useRecents = () => [
  {
    path: "G:/Projects/International clinical terminology and interoperability research",
    openedAt: 0,
  },
];
export const useProjectLabels = () => ({});
export const projectDisplayNameFrom = (path: string) => path.split(/[\\/]/).at(-1) ?? path;
export const projectDisplayName = projectDisplayNameFrom;
export const sameProjectPath = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
export const subscribeProjectPathsChanged = () => () => {};
export const looksLikeProject = () => true;
export const loadArchivedProjects = () => [];
export const loadRecents = useRecents;
export const useModelCatalog = () => ({
  modelsFor: () => [{ id: "codex:gpt-6.1-sol", nativeId: "gpt-6.1-sol", name: "GPT-6.1 Sol" }],
});
export const localDictationModels = {
  list: async () => {
    const state = new URLSearchParams(location.search).get("models");
    if (state === "error") throw new Error("Synthetic local model discovery failure");
    if (state === "loading") return new Promise(() => {});
    return [
      { id: "small", label: "Whisper Small", path: "/fixture/whisper", installed: true },
      {
        id: "turbo",
        label: "Whisper large-v3-turbo",
        path: "/fixture/whisper-turbo",
        installed: false,
      },
    ];
  },
  status: async () =>
    new URLSearchParams(location.search).get("models") === "working"
      ? { state: "working", id: "turbo", action: "download" }
      : { state: "idle" },
  start: async () => ({ state: "ready" }),
  cancel: async () => ({ state: "idle" }),
};

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
  transcriptionModels: async () => {
    const params = new URLSearchParams(location.search);
    if (params.get("catalog") === "loading")
      return new Promise<{ id: string; label: string }[]>(() => {});
    if (params.get("catalog") === "error") throw new Error("Synthetic catalog discovery failure");
    return [
      { id: "openai/gpt-4o-mini-transcribe", label: "OpenAI GPT-4o mini Transcribe" },
      {
        id: "google/gemini-transcription-multilingual",
        label: "Google Gemini multilingual clinical speech transcription preview",
      },
    ];
  },
  start: async (config: unknown, recognitionOnly: boolean) => {
    fixtureDictation.starts.push({ config, recognitionOnly });
    return { lease: "synthetic-dictation", model: "fixture", device: "cpu" };
  },
  release: async () => {
    fixtureDictation.releases++;
  },
  keepAlive: async () => ({ ready: true }),
};

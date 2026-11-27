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
type FixtureModel = { installed: boolean; recommended?: boolean; languages?: string[] };
// Same pure ranking as the real catalog module, which this fixture replaces.
export const supportsDictationLanguage = (model: FixtureModel, language: string) =>
  !language || !model.languages || model.languages.includes(language);
export function rankLocalModels<T extends FixtureModel>(models: T[], language: string) {
  const score = (model: T) =>
    Number(supportsDictationLanguage(model, language)) * 4 +
    Number(model.installed) * 2 +
    Number(Boolean(model.recommended));
  return [...models].sort((left, right) => score(right) - score(left));
}
export const localDictationModels = {
  list: async () => {
    const state = new URLSearchParams(location.search).get("models");
    if (state === "error") throw new Error("Synthetic local model discovery failure");
    if (state === "loading") return new Promise(() => {});
    return [
      {
        id: "small",
        label: "Whisper Small",
        path: "/fixture/whisper",
        installed: true,
        sizeBytes: 484_000_000,
      },
      {
        id: "turbo",
        label: "Whisper large-v3-turbo",
        path: "/fixture/whisper-turbo",
        installed: false,
        sizeBytes: 1_620_000_000,
      },
      {
        id: "nemotron",
        label: "Nemotron Streaming 3.5",
        path: "/fixture/nemotron",
        installed: false,
        sizeBytes: 751_094_240,
        format: "gguf",
        languages: ["en", "tr"],
        recommended: true,
      },
      {
        id: "qwen3",
        label: "Qwen3-ASR 0.6B",
        path: "/fixture/qwen3",
        installed: false,
        sizeBytes: 850_000_000,
        format: "gguf",
        languages: ["en", "tr", "zh"],
      },
      {
        id: "parakeet",
        label: "Parakeet Unified English 0.6B",
        path: "/fixture/parakeet",
        installed: false,
        sizeBytes: 730_000_000,
        format: "gguf",
        languages: ["en"],
        recommended: true,
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
  suggestDictationSettings: async (_id: string, language: string) => ({
    text: JSON.stringify(
      language === "tr"
        ? {
            instructions: "Noktalama işaretlerini düzelt, teknik terimleri koru.",
            correctionCue: "Düzeltiyorum",
          }
        : {
            instructions: "Fix punctuation and preserve technical terms.",
            correctionCue: "Scratch that",
          },
    ),
  }),
  cancelDictationCleanup: async () => ({ cancelled: true }),
  inspect: async (config: unknown) => {
    fixtureDictation.inspected.push(config);
    return { ready: true, missing: [], python: "/fixture/python", whisperPath: "/fixture/whisper" };
  },
  setup: async (config: unknown) => {
    fixtureDictation.installed.push(config);
    return { state: "ready", config, requestedConfig: config };
  },
  setupStatus: async () => ({ state: "idle" }),
  // `?cloud-key=saved|status-error` shows the saved and unreachable-status cloud key rows.
  cloudStatus: async () => {
    const state = new URLSearchParams(location.search).get("cloud-key");
    if (state === "status-error") throw new Error("Synthetic key status failure");
    return { elevenlabs: state === "saved", openrouter: state === "saved" };
  },
  setCloudKey: async (provider: string, key: string | null) => {
    if (new URLSearchParams(location.search).get("cloud-key") === "save-error")
      throw new Error("The key was rejected by the provider.");
    return {
      elevenlabs: provider === "elevenlabs" && key !== null,
      openrouter: provider === "openrouter" && key !== null,
    };
  },
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

import { hostToolRequest } from "../../connections/model/hostFeatureClient";

export type LocalVoiceTranscript = { text: string; language: string; inferenceMs: number };
export type LocalVoiceInfo = { lease: string; model: string; device: string };
export type VoiceRuntimeConfig = {
  python?: string;
  whisperPath?: string;
  ttsPath?: string;
  natural?: boolean;
};
export type VoiceRuntimeStatus = {
  python?: string;
  whisperPath?: string;
  ttsPath?: string;
  missing: string[];
  ready: boolean;
};
export type VoiceChunk = { audio?: string; sampleRate?: number; done?: boolean; error?: string };
export type VoiceSetupStatus = {
  state: "idle" | "installing" | "ready" | "error";
  stage?: "environment" | "packages" | "models" | "checking";
  requestedConfig?: VoiceRuntimeConfig;
  config?: VoiceRuntimeConfig;
  error?: "python_missing" | "install_failed";
  detail?: string;
};

function request<T>(method: string, params: Record<string, unknown> = {}) {
  // Microphone processing stays on this desktop even when the active project is remote.
  return hostToolRequest<T>("", "voice.local.v1", method, params, { kind: "local" });
}
export const localVoiceBackend = {
  setup: (config: VoiceRuntimeConfig) =>
    hostToolRequest<VoiceSetupStatus>(
      "",
      "voice.local.setup.v1",
      "voice.local.setup",
      { config },
      { kind: "local" },
    ),
  setupStatus: () =>
    hostToolRequest<VoiceSetupStatus>(
      "",
      "voice.local.setup.v1",
      "voice.local.setupStatus",
      {},
      { kind: "local" },
    ),
  start: (config?: VoiceRuntimeConfig) =>
    request<LocalVoiceInfo>("voice.local.start", config ? { config } : {}),
  inspect: (config: VoiceRuntimeConfig) =>
    request<VoiceRuntimeStatus>("voice.local.inspect", { config }),
  speak: (lease: string, text: string) =>
    request<{ id: string }>("voice.local.speak", { lease, text }),
  speechNext: (lease: string, id: string) =>
    request<VoiceChunk>("voice.local.speechNext", { lease, id }),
  speechCancel: (lease: string, id: string) => request("voice.local.speechCancel", { lease, id }),
  transcribe: (lease: string, audio: string, language?: string) =>
    request<LocalVoiceTranscript>("voice.local.transcribe", {
      lease,
      audio,
      ...(language ? { language } : {}),
    }),
  keepAlive: (lease: string) => request<{ ready: boolean }>("voice.local.keepAlive", { lease }),
  release: (lease: string) => request("voice.local.release", { lease }),
};

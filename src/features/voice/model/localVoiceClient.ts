import { hostToolRequest } from "../../connections/model/hostFeatureClient";

export type LocalVoiceTranscript = { text: string; language: string; inferenceMs: number };
/** `turn`: the recognizer can judge from a pause whether the sentence is finished. */
export type LocalVoiceInfo = { lease: string; model: string; device: string; turn?: boolean };
export type VoiceRuntimeConfig = {
  python?: string;
  whisperPath?: string;
  ttsPath?: string;
  natural?: boolean;
  /** Natural voice model; omitted means Supertonic 3. */
  engine?: VoiceEngine;
  /** ElevenLabs voice ID (engine "elevenlabs" only). */
  voiceId?: string;
  device?: VoiceDevice;
};
export type VoiceEngine = "supertonic" | "voxcpm2" | "elevenlabs";
/** Where speech models run; "auto" uses a supported NVIDIA GPU when available. */
export type VoiceDevice = "auto" | "gpu" | "cpu";
export type VoiceRuntimeStatus = {
  python?: string;
  whisperPath?: string;
  ttsPath?: string;
  missing: string[];
  ready: boolean;
  gpu?: string;
  accelerated?: boolean;
};
export type VoiceChunk = { audio?: string; sampleRate?: number; done?: boolean; error?: string };
export type VoiceSetupStatus = {
  state: "idle" | "installing" | "ready" | "error";
  stage?: "environment" | "packages" | "gpu" | "models" | "checking";
  requestedConfig?: VoiceRuntimeConfig;
  config?: VoiceRuntimeConfig;
  error?: "python_missing" | "install_failed";
  detail?: string;
};

export type VoiceCloudProvider = "elevenlabs";
export type VoiceCloudStatus = { elevenlabs: boolean };
function cloudRequest<T>(method: string, params: Record<string, unknown> = {}) {
  // Keys stay on this desktop's Host, like microphone processing.
  return hostToolRequest<T>("", "voice.cloud.v1", method, params, { kind: "local" });
}
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
  /** `recognitionOnly` shares the recognizer without loading natural speech (dictation). */
  start: (config?: VoiceRuntimeConfig, recognitionOnly = false) =>
    request<LocalVoiceInfo>("voice.local.start", {
      ...(config ? { config } : {}),
      ...(recognitionOnly ? { recognitionOnly } : {}),
    }),
  inspect: (config: VoiceRuntimeConfig) =>
    request<VoiceRuntimeStatus>("voice.local.inspect", { config }),
  /** `language` picks the pronunciation for multilingual voices. */
  speak: (lease: string, text: string, language?: string) =>
    request<{ id: string }>("voice.local.speak", {
      lease,
      text,
      ...(language ? { language } : {}),
    }),
  speechNext: (lease: string, id: string) =>
    request<VoiceChunk>("voice.local.speechNext", { lease, id }),
  speechCancel: (lease: string, id: string) => request("voice.local.speechCancel", { lease, id }),
  transcribe: (lease: string, audio: string, language?: string) =>
    request<LocalVoiceTranscript>("voice.local.transcribe", {
      lease,
      audio,
      ...(language ? { language } : {}),
    }),
  /** At a pause: text only when the sentence sounds finished, else `complete: false`. */
  endpoint: (lease: string, audio: string, language?: string) =>
    request<LocalVoiceTranscript | { complete: false }>("voice.local.transcribe", {
      lease,
      audio,
      ...(language ? { language } : {}),
      endpoint: true,
    }),
  /** Whether a cloud voice key is stored on this computer's Host; never the key itself. */
  cloudStatus: () => cloudRequest<VoiceCloudStatus>("voice.cloud.status"),
  /** Verifies and stores a key in the Host's encrypted vault; `null` removes it. */
  setCloudKey: (provider: VoiceCloudProvider, key: string | null) =>
    cloudRequest<VoiceCloudStatus>("voice.cloud.setKey", { provider, key }),
  keepAlive: (lease: string) => request<{ ready: boolean }>("voice.local.keepAlive", { lease }),
  release: (lease: string) => request("voice.local.release", { lease }),
};

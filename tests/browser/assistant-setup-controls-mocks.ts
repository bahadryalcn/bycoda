// Finite fixture ports only. Production setup/picker components still render.
import type { ModelSource } from "../../src/features/sessions/ui/modelSource";
import type { AgentModel } from "../../src/features/sessions/model/models";

const model: AgentModel = {
  id: "codex:fixture-worker",
  harness: "codex",
  name: "Fixture worker",
  nativeId: "fixture-worker",
  settings: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      kind: "select",
      value: "low",
      options: [
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
      ],
    },
  ],
};
export const setupModelSource: ModelSource = {
  id: "fixture-local-host",
  accounts: {},
  modelsFor: (harness) => (harness === "codex" ? [model] : []),
  resolve: (harness, id) =>
    harness === "codex" && (!id || id === model.id)
      ? model
      : { id: id ?? "", harness, name: id ?? harness },
  find: (id) => (id === model.id ? model : undefined),
  available: (harness) => harness === "codex",
  probed: () => true,
  refresh: () => {},
};
export const setupVoice = {
  inspections: 0,
  credentials: 0,
  previews: 0,
  microphoneStarts: 0,
  microphoneCloses: 0,
  forbiddenMediaRequests: 0,
  localCallbacks: null as any,
  realtimeCallbacks: null as any,
  transcript(text = "This is a synthetic microphone sentence.") {
    this.localCallbacks?.transcript({ text, language: "en" });
    this.realtimeCallbacks?.transcript(text, "en");
  },
};
(window as any).setupVoice = setupVoice;
export const localVoiceBackend = {
  inspect: async () => {
    setupVoice.inspections++;
    return { ready: true, missing: [] };
  },
};
export async function realtimeSecret() {
  setupVoice.credentials++;
  return { value: "fixture-only-no-provider" };
}
export async function previewVoice(
  _settings: unknown,
  _language: unknown,
  _name: unknown,
  signal?: AbortSignal,
  started?: () => void,
) {
  if (signal?.aborted) return;
  setupVoice.previews++;
  started?.();
}
export class LocalVoice {
  constructor(
    callbacks: unknown,
    _language?: unknown,
    _settings?: unknown,
    level?: { current: number },
  ) {
    setupVoice.localCallbacks = callbacks;
    if (level) level.current = 0.35;
  }
  async connect() {
    setupVoice.microphoneStarts++;
  }
  close() {
    setupVoice.microphoneCloses++;
    setupVoice.localCallbacks = null;
  }
}
export class RealtimeVoice {
  constructor(_provider: unknown, callbacks: unknown) {
    setupVoice.realtimeCallbacks = callbacks;
  }
  async connect() {
    setupVoice.microphoneStarts++;
  }
  close() {
    setupVoice.microphoneCloses++;
    setupVoice.realtimeCallbacks = null;
  }
}

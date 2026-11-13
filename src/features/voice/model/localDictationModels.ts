import { hostToolRequest } from "../../connections/public/hostFeatureClient";
import type { VoiceRuntimeConfig } from "./localVoiceClient";

export type LocalDictationModel = {
  id: "small" | "turbo";
  label: string;
  path: string;
  installed: boolean;
};
export type LocalModelJob = {
  state: "idle" | "working" | "ready" | "error";
  id?: LocalDictationModel["id"];
  action?: "download" | "test" | "delete";
  detail?: string;
};
function request<T>(method: string, params: Record<string, unknown> = {}) {
  return hostToolRequest<T>("", "voice.local.setup.v1", method, params, { kind: "local" });
}
export const localDictationModels = {
  list: () => request<LocalDictationModel[]>("voice.local.models"),
  status: () => request<LocalModelJob>("voice.local.modelStatus"),
  cancel: () => request<LocalModelJob>("voice.local.modelCancel"),
  start: (
    action: NonNullable<LocalModelJob["action"]>,
    id: LocalDictationModel["id"],
    config: VoiceRuntimeConfig,
  ) => request<LocalModelJob>("voice.local.modelAction", { action, id, config }),
};

import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../../../connections/public/connections";
import { isLocalSyncMachine } from "../../../../connections/public/localSync";
import type { RemoteMachine } from "../../../../connections";
import {
  sanitizeBackgroundGradient,
  type BackgroundGradientSuggestion,
} from "../../../model/backgroundGradient";

export type BackgroundSuggestionParams = {
  prompt: string;
  harness: string;
  model: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
};

/** Asks the local Host for one gradient and validates it again before it reaches the background. */
export async function requestBackgroundSuggestion(
  params: BackgroundSuggestionParams,
): Promise<BackgroundGradientSuggestion> {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const machine = machines?.find(isLocalSyncMachine);
  if (!machine) throw new Error("Local host unavailable");
  const result = await remoteRequest<{ gradient?: unknown }>(
    machine.id,
    "appearance.backgroundSuggestions",
    params,
  );
  const gradient = sanitizeBackgroundGradient(result?.gradient);
  if (!gradient) throw new Error("Could not generate a gradient. Try again.");
  return gradient;
}

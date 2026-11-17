import { nativeModelId } from "../../src/features/sessions/model/models";
import { providerTurnInput } from "../../src/integrations/harness/core/providerInput";
import type { HostProvider } from "./providers";

/** Adapter settings `providerTurnInput` derives from the owner's subagent and advisor selection. */
const DERIVED = ["subagentModel", "subagentPolicy", "nativeSubagents", "advisor"] as const;

type SelectionInput = {
  providerAccountId?: string;
  modelSettings?: Record<string, string>;
};

/**
 * Host-run turns (delegated children, tasks, remote and phone conversations) follow the same
 * selection rules as desktop turns: native subagents and Claude's advisor stay inside the owner's
 * selection. Only the derived adapter settings change; bycoda-owned keys stay on the input
 * because Host wrappers still read them (crew tools, chat-only children).
 */
export function selectedTurnInput<T extends SelectionInput>(harness: string, input: T): T {
  if (!input.modelSettings) return input;
  const derived = providerTurnInput({ ...input, harness }, nativeModelId).modelSettings ?? {};
  let settings: Record<string, string> | undefined;
  for (const key of DERIVED) {
    if (derived[key] === input.modelSettings[key]) continue;
    settings ??= { ...input.modelSettings };
    if (derived[key] === undefined) delete settings[key];
    else settings[key] = derived[key];
  }
  return settings ? { ...input, modelSettings: settings } : input;
}

export function withSubagentSelection(id: string, provider: HostProvider): HostProvider {
  return {
    ...provider,
    send: (input) => provider.send(selectedTurnInput(id, input)),
    ...(provider.steer ? { steer: (input) => provider.steer!(selectedTurnInput(id, input)) } : {}),
  };
}

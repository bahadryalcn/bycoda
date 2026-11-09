import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  decodeAdvisor,
  decodeSubagents,
  providerModelSettings,
} from "../../../shared/model/host-contracts/delegation";

/**
 * The one point where bycoda-owned model settings leave for a provider adapter.
 * Every registry entry that hands input to an adapter passes through here.
 */
export function providerInput<T extends { modelSettings?: Record<string, string> }>(input: T): T {
  const modelSettings = providerModelSettings(input.modelSettings);
  return modelSettings === input.modelSettings ? input : { ...input, modelSettings };
}

/** Like `providerInput`, but always on a fresh input with its own settings record. */
export function providerInputCopy<T extends { modelSettings?: Record<string, string> }>(
  input: T,
): T {
  const modelSettings = providerModelSettings(input.modelSettings);
  return { ...input, modelSettings: modelSettings ? { ...modelSettings } : undefined };
}

/** Claude's native Agent tool is removed for the turn. */
export const NATIVE_SUBAGENTS_OFF = "off";

/** Translate only choices the provider's native subagent flags can hold to the selection. */
export function providerTurnInput<
  T extends {
    harness?: string;
    providerAccountId?: string;
    modelSettings?: Record<string, string>;
  },
>(input: T, nativeModelId: (model: string) => string): T {
  const clean = providerInput(input);
  // Other providers' native subagents cannot be held to the selection (they
  // inherit the main model or their own agent definitions); selected models then
  // run through the Host agents tools, which accept only the selection.
  if (input.harness !== "claude" && input.modelSettings?.[CROSS_SUBAGENTS_KEY] !== undefined)
    return { ...clean, modelSettings: { ...clean.modelSettings, nativeSubagents: "off" } };
  if (input.harness !== "claude" || !input.modelSettings) return clean;
  const sameAccount = (ref: { harness: string; providerAccountId?: string }) =>
    ref.harness === "claude" &&
    (ref.providerAccountId ?? "default") === (input.providerAccountId ?? "default");
  const settings = { ...clean.modelSettings };
  const refs = decodeSubagents(input.modelSettings[CROSS_SUBAGENTS_KEY]);
  const advisor = decodeAdvisor(input.modelSettings[CROSS_ADVISOR_KEY]);
  if (input.modelSettings[CROSS_SUBAGENTS_KEY] !== undefined) {
    // Native subagents stay inside the owner's selection: forced onto its one
    // same-account Claude model, otherwise off (other picks run through the Host).
    const native = refs.filter(sameAccount);
    if (native.length === 1) {
      settings.subagentModel = nativeModelId(native[0]!.model);
      settings.subagentPolicy = "force";
    } else {
      settings.subagentModel = NATIVE_SUBAGENTS_OFF;
      delete settings.subagentPolicy;
    }
  }
  if (input.modelSettings[CROSS_ADVISOR_KEY] !== undefined) {
    settings.advisor = "off";
    if (advisor && sameAccount(advisor)) settings.advisor = nativeModelId(advisor.model);
  }
  return { ...clean, modelSettings: settings };
}

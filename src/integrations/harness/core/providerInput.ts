import { runtimeAutomaticSubagents } from "./automaticSubagents";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
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
>(input: T, nativeModelId: (model: string) => string, delegationReady = true): T {
  const clean = providerInput(input);
  if (
    !delegationReady &&
    input.modelSettings?.[CROSS_SUBAGENTS_KEY] === "auto" &&
    !input.modelSettings[CROSS_SUBAGENT_MAX_EFFORT_KEY]
  ) {
    const settings = { ...input.modelSettings };
    delete settings[CROSS_SUBAGENTS_KEY];
    // Preserve advisor enforcement and all provider settings; only Automatic permits widening.
    const fallback = providerTurnInput({ ...input, modelSettings: settings }, nativeModelId);
    return input.harness === "codex"
      ? { ...fallback, modelSettings: { ...fallback.modelSettings, nativeSubagents: "on" } }
      : fallback;
  }
  // Other providers' native subagents cannot be held to the selection (they
  // inherit the main model or their own agent definitions); selected models then
  // run through the Host agents tools, which accept only the selection.
  if (
    input.harness !== "claude" &&
    (input.modelSettings?.[CROSS_SUBAGENTS_KEY] !== undefined ||
      input.modelSettings?.[CROSS_SUBAGENT_MAX_EFFORT_KEY])
  )
    return { ...clean, modelSettings: { ...clean.modelSettings, nativeSubagents: "off" } };
  if (input.harness !== "claude" || !input.modelSettings) return clean;
  const sameAccount = (ref: { harness: string; providerAccountId?: string }) =>
    ref.harness === "claude" &&
    (ref.providerAccountId ?? "default") === (input.providerAccountId ?? "default");
  const settings = { ...clean.modelSettings };
  const refs =
    input.modelSettings[CROSS_SUBAGENTS_KEY] === "auto"
      ? runtimeAutomaticSubagents(input)
      : decodeSubagents(input.modelSettings[CROSS_SUBAGENTS_KEY]);
  const advisor = decodeAdvisor(input.modelSettings[CROSS_ADVISOR_KEY]);
  if (
    input.modelSettings[CROSS_SUBAGENTS_KEY] !== undefined ||
    input.modelSettings[CROSS_SUBAGENT_MAX_EFFORT_KEY]
  ) {
    // Native subagents stay inside the owner's selection: forced onto its one
    // same-account Claude model, otherwise off (other picks run through the Host).
    const native = refs.filter(sameAccount);
    if (
      !input.modelSettings[CROSS_SUBAGENT_MAX_EFFORT_KEY] &&
      native.length === 1 &&
      (input.modelSettings[CROSS_SUBAGENTS_KEY] !== "auto" || refs.length === 1)
    ) {
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

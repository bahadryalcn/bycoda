import { providerModelSettings } from "../../../shared/model/host-contracts/delegation";

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

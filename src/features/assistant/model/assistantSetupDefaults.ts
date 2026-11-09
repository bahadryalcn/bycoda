import type { AssistantProfilePatch } from "../../../shared/model/host-contracts/assistant";

export const ASSISTANT_SETUP_TOKEN_BUDGET = 1_000_000;

/** Offer a usable budget for initial setup without changing saved policy or authority. */
export function assistantSetupDefaults(profile: AssistantProfilePatch): AssistantProfilePatch {
  return profile.setupComplete !== true &&
    (profile.dailyTokenBudget === undefined || profile.dailyTokenBudget === 0)
    ? { ...profile, dailyTokenBudget: ASSISTANT_SETUP_TOKEN_BUDGET }
    : profile;
}

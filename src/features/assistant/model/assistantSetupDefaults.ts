import {
  ASSISTANT_MIN_DAILY_TOKEN_BUDGET,
  type AssistantProfilePatch,
} from "../../../shared/model/host-contracts/assistant";

export const ASSISTANT_SETUP_TOKEN_BUDGET = 1_000_000;

/** Offer a usable budget in setup when none (or one below the minimum) is saved. Setup no
 * longer asks for a budget, so a missing one must not block it; Start saves the shown value. */
export function assistantSetupDefaults(profile: AssistantProfilePatch): AssistantProfilePatch {
  return (profile.dailyTokenBudget ?? 0) < ASSISTANT_MIN_DAILY_TOKEN_BUDGET
    ? { ...profile, dailyTokenBudget: ASSISTANT_SETUP_TOKEN_BUDGET }
    : profile;
}

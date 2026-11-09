import { useState } from "react";
import { getStatsChoice, useAccountState } from "../../account";
import { accountStepSeen, onboardingSteps, type OnboardingStepId } from "./onboarding";

/** The setup steps, fixed when the dialog opens apart from the account service becoming unavailable. */
export function useOnboardingSteps(): OnboardingStepId[] {
  const available = useAccountState().phase !== "unavailable";
  const [accountSeen] = useState(accountStepSeen);
  const [statsAsked] = useState(() => getStatsChoice() !== null);
  return onboardingSteps(!accountSeen && available, !statsAsked && available);
}

const KEY = "bycoda.onboarding.v1";
export const OPEN_ONBOARDING_EVENT = "bycoda:open-onboarding";

export type OnboardingContext = {
  projects: number;
  sessions: number;
  restored: boolean;
  transferred: boolean;
};

/** Upgrades and transferred windows keep their workspace without a setup prompt. */
export function shouldShowOnboarding(context: OnboardingContext): boolean {
  if (context.projects || context.sessions || context.restored || context.transferred) return false;
  try {
    return localStorage.getItem(KEY) === null;
  } catch {
    return false;
  }
}

export function finishOnboarding(): void {
  try {
    localStorage.setItem(KEY, "complete");
  } catch {
    // The current window still dismisses setup when storage is unavailable.
  }
}

const ACCOUNT_STEP_KEY = "bycoda.onboarding.account.v1";

/** True once the optional sign-in step was shown and left, whichever way. */
export function accountStepSeen(): boolean {
  try {
    return localStorage.getItem(ACCOUNT_STEP_KEY) !== null;
  } catch {
    return false;
  }
}

export function markAccountStepSeen(): void {
  try {
    localStorage.setItem(ACCOUNT_STEP_KEY, "seen");
  } catch {
    // The step only repeats on the next setup when storage is unavailable.
  }
}

export type OnboardingStepId =
  | "Account"
  | "Statistics"
  | "Workspace"
  | "Appearance"
  | "Agents"
  | "Connections"
  | "Projects";

/**
 * The optional account step leads the setup; it is left out when the build has no accounts or it
 * was already seen. The statistics question follows it until the user has answered.
 */
export function onboardingSteps(showAccount: boolean, showStatistics = false): OnboardingStepId[] {
  const steps: OnboardingStepId[] = [
    "Workspace",
    "Appearance",
    "Agents",
    "Connections",
    "Projects",
  ];
  const leading: OnboardingStepId[] = [];
  if (showAccount) leading.push("Account");
  if (showStatistics) leading.push("Statistics");
  return [...leading, ...steps];
}

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

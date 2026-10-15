// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { finishOnboarding, shouldShowOnboarding, type OnboardingContext } from "./onboarding";

const fresh: OnboardingContext = {
  projects: 0,
  sessions: 0,
  restored: false,
  transferred: false,
};
beforeEach(() => localStorage.clear());
describe("first-run onboarding", () => {
  it("opens on a fresh installation", () => expect(shouldShowOnboarding(fresh)).toBe(true));
  it.each([{ projects: 1 }, { sessions: 1 }, { restored: true }, { transferred: true }])(
    "preserves existing work: %j",
    (context) => {
      expect(shouldShowOnboarding({ ...fresh, ...context })).toBe(false);
    },
  );
  it("does not reopen after finishing or skipping", () => {
    finishOnboarding();
    expect(shouldShowOnboarding(fresh)).toBe(false);
  });
});

// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { addOnboardingProviders, loadOnboardingProviders } from "./onboardingProviders";

beforeEach(() => localStorage.clear());

it("starts with no manual choices instead of importing the legacy forced provider list", () => {
  localStorage.setItem(
    "bycoda.onboarding.providers.v1",
    JSON.stringify(["claude", "codex", "cursor"]),
  );
  expect(loadOnboardingProviders()).toEqual([]);
});

it("remembers only explicit valid choices without duplicates", () => {
  expect(addOnboardingProviders(["cursor"])).toEqual(["cursor"]);
  expect(addOnboardingProviders(["cursor", "codex"])).toEqual(["cursor", "codex"]);
  expect(loadOnboardingProviders()).toEqual(["codex", "cursor"]);
  localStorage.setItem("bycoda.onboarding.providers.v2", '["missing", "codex", "codex", 7]');
  expect(loadOnboardingProviders()).toEqual(["codex"]);
});

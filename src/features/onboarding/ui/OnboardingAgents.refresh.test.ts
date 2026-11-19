import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression for #1193: a refresh must not wipe provider status, hide action buttons,
// or announce once per row.
const source = readFileSync("src/features/onboarding/ui/OnboardingAgents.tsx", "utf8");

describe("onboarding agent refresh (#1193)", () => {
  it("keeps the last known provider status while re-probing", () => {
    expect(source).not.toMatch(/setAuth\(\{\}\)/);
  });

  it("gates action buttons on the first scan, not on every refresh", () => {
    expect(source).not.toMatch(/!checking\s*&&/);
    expect(source).toMatch(/probed && !available/);
  });

  it("does not put a live region on every provider row", () => {
    expect(source).not.toMatch(/as="small"\s+role="status"/);
    expect(source.match(/<LiveText\b/g)?.length).toBe(1);
  });

  it("reports real status read failures instead of dropping them", () => {
    expect(source).toMatch(/readHarnessAuthStatus\(provider, accountId\)\s*\.then\([\s\S]*?\.catch\(/);
  });
});

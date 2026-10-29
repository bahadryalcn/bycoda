import { describe, expect, it } from "vitest";
import { persistProviderPreference } from "./providerPreferenceOutcome";

describe("provider preference outcome", () => {
  it("reports saved only when the read-back matches", () => {
    let stored = "";
    expect(
      persistProviderPreference(
        () => (stored = "x"),
        () => stored === "x",
      ),
    ).toEqual({ state: "saved" });
  });

  it("reports unsaved when storage silently dropped the write", () => {
    const outcome = persistProviderPreference(
      () => undefined,
      () => false,
    );
    expect(outcome.state).toBe("unsaved");
  });

  it("reports unsaved with the error when the write throws", () => {
    expect(
      persistProviderPreference(
        () => {
          throw new Error("quota");
        },
        () => true,
      ),
    ).toEqual({ state: "unsaved", message: "quota" });
  });
});

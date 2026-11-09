import { describe, expect, it } from "vitest";
import { chooseCandidate, classifyScreen, isUnsafeLabel } from "./decision-layer";
import { fakeDecisions } from "./test-support";
import type { ScreenSnapshot } from "./screen-summary";

const snapshot: ScreenSnapshot = {
  summary: {
    url: "https://x.example/",
    title: "",
    buttons: ["Accept all"],
    fields: [],
    headings: [],
    errors: [],
  },
  candidates: [
    { id: "c1", label: "Accept all", selector: "html > body:nth-child(2) > button:nth-child(1)" },
  ],
};

describe("decision layer", () => {
  it("accepts a screen state only at or above the 0.85 threshold", async () => {
    const high = await classifyScreen(
      fakeDecisions({ screen: { value: "cookie_banner", confidence: 0.85 } }),
      snapshot,
    );
    expect(high).toEqual({ ok: true, value: "cookie_banner", confidence: 0.85 });
    const low = await classifyScreen(
      fakeDecisions({ screen: { value: "cookie_banner", confidence: 0.84 } }),
      snapshot,
    );
    expect(low).toEqual({ ok: false, reason: "below_threshold" });
  });

  it("treats a provider error and an unknown state key as unavailable", async () => {
    expect(await classifyScreen(fakeDecisions({ screen: "unavailable" }), snapshot)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(
      await classifyScreen(
        fakeDecisions({ screen: { value: "made_up", confidence: 0.99 } }),
        snapshot,
      ),
    ).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("returns no_candidate without asking the model when there is nothing to pick", async () => {
    const decisions = fakeDecisions({ element: { value: "c1", confidence: 0.99 } });
    expect(await chooseCandidate(decisions, [])).toEqual({ ok: false, reason: "no_candidate" });
    expect(decisions.calls).toHaveLength(0);
  });

  it("maps the chosen id back to its candidate and rejects ids that were not offered", async () => {
    const chosen = await chooseCandidate(
      fakeDecisions({ element: { value: "c1", confidence: 0.9 } }),
      snapshot.candidates,
    );
    expect(chosen.ok && chosen.value.label).toBe("Accept all");
    const invented = await chooseCandidate(
      fakeDecisions({ element: { value: "c9", confidence: 0.99 } }),
      snapshot.candidates,
    );
    expect(invented).toEqual({ ok: false, reason: "unavailable" });
  });

  it("flags submit, payment, send, delete and sign-in labels as unsafe", () => {
    for (const label of ["Delete account", "Sign in", "Pay now", "Send", "Gönder", "Log in"])
      expect(isUnsafeLabel(label)).toBe(true);
    for (const label of ["Accept all", "Reject all", "Close", "Kabul et"])
      expect(isUnsafeLabel(label)).toBe(false);
  });
});

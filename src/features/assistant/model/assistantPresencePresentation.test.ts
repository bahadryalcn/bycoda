import { expect, it } from "vitest";
import { assistantPresencePresentation } from "./assistantPresencePresentation";

it.each([
  ["present", "Here", "success"],
  ["away", "Away", "warning"],
  ["idle", "Idle", "warning"],
  ["dnd", "Do not disturb", "danger"],
  ["locked", "Locked", "danger"],
  ["unknown", "Unknown", "neutral"],
] as const)("presents %s with its semantic availability tone", (state, label, tone) => {
  expect(assistantPresencePresentation(state)).toEqual({ state, label, tone });
});

it("never presents failed, pending or unsupported observations as Here", () => {
  expect(assistantPresencePresentation("present", true)).toEqual({ state: "unknown", label: "Unknown", tone: "neutral" });
  for (const state of [undefined, null, "active", "busy", "constructor", {}, false]) {
    expect(assistantPresencePresentation(state).state).toBe("unknown");
  }
});

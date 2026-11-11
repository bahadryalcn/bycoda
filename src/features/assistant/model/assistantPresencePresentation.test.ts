import { expect, it } from "vitest";
import { assistantPresencePresentation } from "./assistantPresencePresentation";

it.each([
  ["present", "Here", "success"],
  ["away", "Away", "warning"],
  ["idle", "Idle", "warning"],
  ["dnd", "Do not disturb", "danger"],
  ["locked", "Locked", "danger"],
  ["offline", "Offline", "neutral"],
] as const)("presents %s with its semantic availability tone", (state, label, tone) => {
  expect(assistantPresencePresentation(state)).toEqual({ state, label, tone });
});

it("maps a missing or unrecognized value to offline, never to Here", () => {
  expect(assistantPresencePresentation(undefined)).toEqual({
    state: "offline",
    label: "Offline",
    tone: "neutral",
  });
  for (const state of [null, "unknown", "active", "busy", "constructor", {}, false]) {
    expect(assistantPresencePresentation(state).state).toBe("offline");
  }
});

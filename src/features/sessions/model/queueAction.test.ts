import { expect, it } from "vitest";
import { canSendQueueMessage } from "./queueAction";

const state = { blocked: false, busy: true, steerSupported: false, route: "join" as const };
it("waits for idle when mid-turn input is unsupported", () => {
  expect(canSendQueueMessage({}, state)).toBe(false);
  expect(canSendQueueMessage({}, { ...state, busy: false })).toBe(true);
});
it.each(["restart", "switch"] as const)(
  "preserves explicit %s despite unavailable mid-turn input",
  (route) => {
    expect(canSendQueueMessage({}, { ...state, route })).toBe(true);
    expect(canSendQueueMessage({ deliveryUnknown: true }, { ...state, route })).toBe(false);
    expect(canSendQueueMessage({}, { ...state, route, blocked: true })).toBe(false);
    expect(canSendQueueMessage({ intent: "plan" }, { ...state, route })).toBe(false);
  },
);

import { expect, it } from "vitest";
import {
  defaultParticipants,
  isSettledSession,
  SETTLE_ACTIVITY_GRACE_MS,
} from "./sessionLifecycle";

it("files only settled sessions on the shelf", () => {
  expect(isSettledSession({ state: "settled", settledAt: 10 }, 5)).toBe(true);
  expect(isSettledSession({ state: "settling" }, 5)).toBe(false);
  expect(isSettledSession({ state: "active" }, 5)).toBe(false);
  expect(isSettledSession(undefined, 5)).toBe(false);
});

it("shows a session active once it has activity clearly newer than the settle", () => {
  const settledAt = 100_000;
  const view = { state: "settled" as const, settledAt };
  expect(isSettledSession(view, settledAt + SETTLE_ACTIVITY_GRACE_MS + 1)).toBe(false);
  expect(isSettledSession(view, settledAt + SETTLE_ACTIVITY_GRACE_MS)).toBe(true);
  expect(isSettledSession({ state: "settled" }, settledAt * 2)).toBe(true);
  expect(isSettledSession(view, undefined)).toBe(true);
});

it("defaults to one owner participant, signed out", () => {
  expect(defaultParticipants()).toEqual([{ userId: null, role: "owner" }]);
});

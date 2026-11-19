import { describe, expect, it } from "vitest";
import { pollRoundPending } from "./useAccountsData";

// Regression for #1060: a poll tick must not start a round while an earlier one is still pending,
// but a round that never settles must not stop polling forever.
describe("pollRoundPending", () => {
  it("lets a tick start a round when none is pending", () => {
    expect(pollRoundPending(undefined, 0)).toBe(false);
  });

  it("blocks a tick while a fresh round is still in flight", () => {
    expect(pollRoundPending({ startedAt: 0 }, 59_999)).toBe(true);
  });

  it("stops blocking after two intervals so one stuck Host cannot freeze polling", () => {
    expect(pollRoundPending({ startedAt: 0 }, 119_999)).toBe(true);
    expect(pollRoundPending({ startedAt: 0 }, 120_000)).toBe(false);
  });
});

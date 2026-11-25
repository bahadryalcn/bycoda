import { describe, expect, it } from "vitest";
import { claimAutoContinue, isAutoContinueDue, markAutoContinueDue } from "./autoContinue";
import { classifyTurnRecovery, shouldAutoContinue, type TurnRecoveryInput } from "./turnRecovery";

const base: TurnRecoveryInput = {
  wasInFlight: true,
  liveness: "dead",
  backgroundWorkAlive: false,
  transcript: "open",
};

describe("classifyTurnRecovery", () => {
  it("leaves a live turn alone, and background work counts as live", () => {
    expect(classifyTurnRecovery({ ...base, liveness: "alive", transcript: "open" })).toEqual({
      state: "running",
      certain: true,
    });
    expect(
      classifyTurnRecovery({ ...base, backgroundWorkAlive: true, transcript: "ended" }).state,
    ).toBe("running");
  });

  it("calls a turn whose transcript ended finished, whatever the process says", () => {
    expect(classifyTurnRecovery({ ...base, transcript: "ended" })).toEqual({
      state: "finished",
      certain: true,
    });
    expect(classifyTurnRecovery({ ...base, liveness: "unknown", transcript: "ended" }).state).toBe(
      "finished",
    );
  });

  it("calls a dead process with an open transcript interrupted, for certain", () => {
    expect(classifyTurnRecovery(base)).toEqual({ state: "interrupted", certain: true });
  });

  it("does not claim certainty when the facts are thin", () => {
    for (const transcript of ["unknown", "missing", "unsupported"] as const) {
      expect(classifyTurnRecovery({ ...base, transcript })).toEqual({
        state: "interrupted",
        certain: false,
      });
    }
    expect(classifyTurnRecovery({ ...base, liveness: "unknown" })).toEqual({
      state: "interrupted",
      certain: false,
    });
  });

  it("has nothing to recover when the turn was not in flight", () => {
    expect(classifyTurnRecovery({ ...base, wasInFlight: false }).state).toBe("finished");
  });
});

describe("shouldAutoContinue", () => {
  const cut = { state: "interrupted", certain: true } as const;

  it("continues only a certain interruption, with the setting on and nothing queued", () => {
    expect(shouldAutoContinue({ recovery: cut, enabled: true, queuedCount: 0 })).toBe(true);
    expect(shouldAutoContinue({ recovery: cut, enabled: false, queuedCount: 0 })).toBe(false);
    expect(shouldAutoContinue({ recovery: cut, enabled: true, queuedCount: 2 })).toBe(false);
    expect(
      shouldAutoContinue({
        recovery: { state: "interrupted", certain: false },
        enabled: true,
        queuedCount: 0,
      }),
    ).toBe(false);
    for (const state of ["running", "finished"] as const) {
      expect(
        shouldAutoContinue({ recovery: { state, certain: true }, enabled: true, queuedCount: 0 }),
      ).toBe(false);
    }
  });
});

describe("autoContinue", () => {
  it("is claimed once per chat", () => {
    markAutoContinueDue("s-claim");
    expect(isAutoContinueDue("s-claim")).toBe(true);
    expect(claimAutoContinue("s-claim")).toBe(true);
    expect(claimAutoContinue("s-claim")).toBe(false);
    expect(isAutoContinueDue("s-claim")).toBe(false);
  });
});

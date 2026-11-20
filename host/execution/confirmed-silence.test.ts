import { describe, expect, it } from "vitest";
import type { HostStore } from "../store";
import { confirmedSilence, observeSupervisionClock, stallConfirmed } from "./confirmed-silence";

const MINUTE = 60_000;
const store = () => ({}) as HostStore;

describe("confirmed silence", () => {
  it("measures plain wall-clock age in a process that has seen nothing earlier", () => {
    // A Host restart keeps durable stall detection: the persisted activity time is the proof.
    expect(confirmedSilence(store(), 1_000, 1_000 + 20 * MINUTE, 7)).toBe(20 * MINUTE);
    expect(stallConfirmed(store(), 1_000, 15 * MINUTE, 1_000 + 20 * MINUTE, 7)).toBe(true);
  });

  it("does not count a suspended interval as silence", () => {
    const host = store();
    observeSupervisionClock(host, 0, 0);
    observeSupervisionClock(host, MINUTE, MINUTE);
    // The machine slept for an hour: wall time moved, the monotonic clock barely did.
    const woke = MINUTE + 60 * MINUTE;
    expect(confirmedSilence(host, 0, woke, MINUTE + 500)).toBeLessThan(2 * MINUTE);
    expect(stallConfirmed(host, 0, 15 * MINUTE, woke, MINUTE + 500)).toBe(false);
  });

  it("does not count a sleep the monotonic clock also spanned", () => {
    const host = store();
    observeSupervisionClock(host, 0, 0);
    // Some platforms keep counting monotonic time across sleep; the beat gap is still too long.
    expect(stallConfirmed(host, 0, 15 * MINUTE, 60 * MINUTE, 60 * MINUTE)).toBe(false);
  });

  it("detects a real stall again once silence is observed after the wake", () => {
    const host = store();
    observeSupervisionClock(host, 0, 0);
    let wall = MINUTE,
      mono = MINUTE;
    observeSupervisionClock(host, wall, mono);
    wall += 60 * MINUTE;
    mono += 500;
    expect(stallConfirmed(host, 0, 15 * MINUTE, wall, mono)).toBe(false);
    for (let beat = 0; beat < 13; beat++) {
      wall += MINUTE;
      mono += MINUTE;
      expect(stallConfirmed(host, 0, 15 * MINUTE, wall, mono)).toBe(false);
    }
    wall += MINUTE;
    mono += MINUTE;
    expect(stallConfirmed(host, 0, 15 * MINUTE, wall, mono)).toBe(true);
  });

  it("never makes output right after a sleep look stalled", () => {
    const host = store();
    observeSupervisionClock(host, 0, 0);
    const woke = 60 * MINUTE;
    expect(confirmedSilence(host, woke - 1_000, woke, 500)).toBeLessThanOrEqual(1_000);
    expect(stallConfirmed(host, woke - 1_000, 15 * MINUTE, woke, 500)).toBe(false);
  });

  it("treats a forward clock jump like a sleep", () => {
    const host = store();
    observeSupervisionClock(host, 0, 0);
    observeSupervisionClock(host, MINUTE, MINUTE);
    expect(stallConfirmed(host, 0, 15 * MINUTE, MINUTE + 30 * MINUTE, MINUTE)).toBe(false);
  });
});

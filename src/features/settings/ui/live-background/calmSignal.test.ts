import { describe, expect, it } from "vitest";
import { CLOSED_SIGNAL, createLiveSignalDriver } from "./calmSignal";

describe("calm activity envelope", () => {
  it("responds equally to slow text, large bursts and tool-only activity", () => {
    const slow = createLiveSignalDriver();
    const burst = createLiveSignalDriver();
    const tools = createLiveSignalDriver();
    for (let frame = 0; frame < 90; frame++) {
      const time = frame / 30;
      const expected = slow.update(time, 1 / 30, frame);
      expect(burst.update(time, 1 / 30, frame * 10000)).toEqual(expected);
      expect(tools.update(time, 1 / 30, -1, frame * 300)).toEqual(expected);
    }
  });

  it("eases without jumps and fully rests before the two-second paint cutoff", () => {
    const driver = createLiveSignalDriver();
    let previous = 0;
    for (let frame = 0; frame < 90; frame++) {
      const { presence } = driver.update(frame / 30, 1 / 30, 1);
      expect(presence).toBeGreaterThanOrEqual(previous);
      expect(presence - previous).toBeLessThan(0.04);
      previous = presence;
    }
    expect(previous).toBe(1);
    let resting = CLOSED_SIGNAL;
    for (let frame = 0; frame < 57; frame++) {
      resting = driver.update(3 + frame / 30, 1 / 30, -1);
      expect(resting.presence).toBeLessThanOrEqual(previous);
      expect(previous - resting.presence).toBeLessThan(0.04);
      previous = resting.presence;
    }
    expect(resting).toEqual(CLOSED_SIGNAL);
  });

  it("does not jump after a suspended window or invalid timing", () => {
    const driver = createLiveSignalDriver();
    expect(driver.update(1, NaN, 10)).toEqual(CLOSED_SIGNAL);
    expect(driver.update(1, -1, 10)).toEqual(CLOSED_SIGNAL);
    expect(driver.update(100, 100, 10).presence).toBeLessThan(0.02);
  });
});

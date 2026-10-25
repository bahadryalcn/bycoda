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
      expect(burst.update(time, 1 / 30, frame * 10000).presence).toBe(expected.presence);
      expect(tools.update(time, 1 / 30, -1, frame * 300).presence).toBe(expected.presence);
    }
  });

  it("eases without jumps and fully rests before the two-second paint cutoff", () => {
    const driver = createLiveSignalDriver();
    let previous = 0;
    for (let frame = 0; frame < 90; frame++) {
      const { presence } = driver.update(frame / 30, 1 / 30, 1);
      expect(presence).toBeGreaterThanOrEqual(previous);
      expect(presence - previous).toBeLessThan(0.12);
      previous = presence;
    }
    expect(previous).toBe(1);
    let resting = CLOSED_SIGNAL;
    for (let frame = 0; frame < 57; frame++) {
      resting = driver.update(3 + frame / 30, 1 / 30, -1);
      expect(resting.presence).toBeLessThanOrEqual(previous);
      expect(previous - resting.presence).toBeLessThan(0.05);
      previous = resting.presence;
    }
    expect(resting).toEqual(CLOSED_SIGNAL);
  });

  it("does not jump after a suspended window or invalid timing", () => {
    const driver = createLiveSignalDriver();
    expect(driver.update(1, NaN, 10)).toEqual(CLOSED_SIGNAL);
    expect(driver.update(1, -1, 10)).toEqual(CLOSED_SIGNAL);
    expect(driver.update(100, 100, 10).presence).toBeLessThan(0.15);
  });

  it("makes even a short reply visible within half a second", () => {
    const driver = createLiveSignalDriver();
    let presence = 0;
    for (let frame = 0; frame < 15; frame++) {
      presence = driver.update(frame / 30, 1 / 30, frame).presence;
    }
    expect(presence).toBe(1);
  });

  it("responds to new text while a busy but stalled turn settles", () => {
    const streaming = createLiveSignalDriver();
    const stalled = createLiveSignalDriver();
    let moving = CLOSED_SIGNAL;
    let waiting = CLOSED_SIGNAL;
    for (let frame = 0; frame < 90; frame++) {
      moving = streaming.update(frame / 30, 1 / 30, frame * 8);
      waiting = stalled.update(frame / 30, 1 / 30, 8);
    }
    expect(moving.presence).toBe(waiting.presence);
    expect(moving.energy).toBeGreaterThan(0.3);
    expect(waiting.energy ?? 0).toBeLessThan(0.01);
  });

  it("reacts to tool progress and bounds giant provider bursts without flashing", () => {
    const driver = createLiveSignalDriver();
    let previous = 0;
    for (let frame = 0; frame < 60; frame++) {
      const energy = driver.update(frame / 30, 1 / 30, -1, frame * 1e9).energy ?? 0;
      expect(energy).toBeGreaterThanOrEqual(0);
      expect(energy).toBeLessThanOrEqual(1);
      expect(Math.abs(energy - previous)).toBeLessThan(0.18);
      previous = energy;
    }
    expect(previous).toBeGreaterThan(0.5);
    let resting = CLOSED_SIGNAL;
    for (let frame = 0; frame < 60; frame++) resting = driver.update(2 + frame / 30, 1 / 30, -1);
    expect(resting).toEqual(CLOSED_SIGNAL);
  });
});

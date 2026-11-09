import { describe, expect, it } from "vitest";
import {
  CLOSED_SIGNAL,
  FADE_SECONDS,
  REST_SECONDS,
  SHOW_SECONDS,
  createLiveSignalDriver,
} from "./calmSignal";
import type { LiveSignal } from "./types";

const FRAME = 1 / 30;
type Driver = ReturnType<typeof createLiveSignalDriver>;

/** Runs `seconds` of 30 fps frames; `lengths` gives text and activity per frame time. */
function play(
  driver: Driver,
  from: number,
  seconds: number,
  lengths: (time: number) => readonly [number, number],
): LiveSignal[] {
  const frames: LiveSignal[] = [];
  const count = Math.round(seconds / FRAME);
  for (let frame = 0; frame < count; frame++) {
    const time = from + frame * FRAME;
    const [text, activity] = lengths(time);
    frames.push(driver.update(time, FRAME, text, activity));
  }
  return frames;
}

/** Lengths of the runs of visible and hidden frames, in seconds, starting with a visible run. */
function runs(frames: LiveSignal[]): { shown: number[]; hidden: number[] } {
  const shown: number[] = [];
  const hidden: number[] = [];
  let visible = frames[0]!.presence > 0;
  let length = 0;
  for (const { presence } of frames) {
    if (presence > 0 === visible) {
      length++;
      continue;
    }
    (visible ? shown : hidden).push(length * FRAME);
    visible = presence > 0;
    length = 1;
  }
  return { shown, hidden };
}

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

  it("eases in without jumps and holds after a short reply instead of vanishing", () => {
    const driver = createLiveSignalDriver();
    let previous = 0;
    for (const { presence } of play(driver, 0, 1, (t) => [Math.floor(t * 40), 0])) {
      expect(presence).toBeGreaterThanOrEqual(previous);
      expect(presence - previous).toBeLessThan(0.12);
      previous = presence;
    }
    expect(previous).toBe(1);
    // The reply ends after one second; the scene stays for the rest of its show window.
    const held = play(driver, 1, SHOW_SECONDS[0] - 1.1, () => [-1, -1]);
    expect(held.every(({ presence }) => presence === 1)).toBe(true);
    // Then it fades out smoothly and rests.
    const fading = play(
      driver,
      SHOW_SECONDS[0] - 0.1,
      SHOW_SECONDS[1] - SHOW_SECONDS[0] + 2,
      () => [-1, -1],
    );
    for (const { presence } of fading) {
      expect(presence).toBeLessThanOrEqual(previous);
      expect(previous - presence).toBeLessThan(0.05);
      previous = presence;
    }
    expect(fading.at(-1)).toEqual(CLOSED_SIGNAL);
    expect(driver.awake()).toBe(false);
  });

  it("does not return while the pane is idle", () => {
    const driver = createLiveSignalDriver();
    play(driver, 0, 1, (t) => [Math.floor(t * 40), Math.floor(t * 40)]);
    const idle = play(driver, 1, 60, () => [-1, -1]);
    const last = idle.findLastIndex(({ presence }) => presence > 0);
    expect(last * FRAME).toBeLessThan(SHOW_SECONDS[1] + FADE_SECONDS);
    expect(idle.slice(last + 1).every((signal) => signal.presence === 0)).toBe(true);
  });

  it("alternates between showing and resting through a long reply", () => {
    const driver = createLiveSignalDriver();
    const frames = play(driver, 0, 120, (t) => [Math.floor(t * 40), Math.floor(t * 60)]);
    const { shown, hidden } = runs(frames);
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(hidden.length).toBeGreaterThanOrEqual(3);
    for (const length of shown) {
      expect(length).toBeGreaterThanOrEqual(SHOW_SECONDS[0]);
      expect(length).toBeLessThanOrEqual(SHOW_SECONDS[1] + FADE_SECONDS + 0.1);
    }
    for (const length of hidden) {
      expect(length).toBeGreaterThanOrEqual(REST_SECONDS[0] - 0.1);
      expect(length).toBeLessThanOrEqual(REST_SECONDS[1] + 0.1);
    }
    // Lengths vary between appearances.
    expect(new Set(shown.map((length) => Math.round(length))).size).toBeGreaterThan(1);
  });

  it("waits for new output after its rest while a tool runs silently", () => {
    const driver = createLiveSignalDriver();
    play(driver, 0, 1, (t) => [Math.floor(t * 40), 40]);
    // The tool runs for a minute without output: the scene shows once, then stays hidden.
    const waiting = play(driver, 1, 60, () => [-1, 80]);
    expect(waiting.at(-1)).toEqual(CLOSED_SIGNAL);
    expect(runs(waiting).shown).toHaveLength(1);
    // Output resumes after the rest: the scene returns within half a second.
    const resumed = play(driver, 61, 0.5, (t) => [Math.floor((t - 61) * 40) + 1, 80]);
    expect(resumed.at(-1)!.presence).toBe(1);
  });

  it("lets a new turn appear at once, even during the previous turn's rest", () => {
    const driver = createLiveSignalDriver();
    play(driver, 0, 1, (t) => [Math.floor(t * 40), Math.floor(t * 40) + 500]);
    play(driver, 1, SHOW_SECONDS[1] + FADE_SECONDS + 0.5, () => [-1, -1]);
    expect(driver.awake()).toBe(false);
    const next = play(driver, 20, 0.5, () => [-1, 0]);
    expect(next.at(-1)!.presence).toBe(1);
  });

  it("stops speaking soon after output pauses while the scene stays", () => {
    const driver = createLiveSignalDriver();
    const talking = play(driver, 0, 2, (t) => [Math.floor(t * 40), Math.floor(t * 40)]);
    expect(talking.at(-1)!.speaking).toBeGreaterThan(0.9);
    const paused = play(driver, 2, 2, () => [80, 80]);
    expect(paused.at(-1)!.presence).toBe(1);
    expect(paused.at(-1)!.speaking).toBeLessThan(0.05);
  });

  it("follows the wall clock across paused frames", () => {
    const driver = createLiveSignalDriver();
    for (let frame = 0; frame < 30; frame++)
      driver.update(0, FRAME, frame, frame, 100 + frame * FRAME);
    expect(driver.awake()).toBe(true);
    // The canvas slept for twenty seconds; the show window has passed.
    driver.update(0, FRAME, 29, 29, 121);
    for (let frame = 0; frame < 45; frame++) driver.update(0, FRAME, 29, 29, 121 + frame * FRAME);
    expect(driver.awake()).toBe(false);
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

  it("responds to new text while a busy but stalled turn holds", () => {
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
    const resting = play(driver, 2, SHOW_SECONDS[1] + FADE_SECONDS, () => [-1, -1]);
    expect(resting.at(-1)).toEqual(CLOSED_SIGNAL);
  });
});

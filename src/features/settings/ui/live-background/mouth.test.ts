import { describe, expect, it } from "vitest";
import { createLiveSignalDriver } from "./mouth";

function run(steps: [reply: number, activity: number][]) {
  const driver = createLiveSignalDriver();
  let time = 0;
  let signal = driver.update(time, 0, -1, -1);
  for (const [reply, activity] of steps) {
    time += 1 / 30;
    signal = driver.update(time, 1 / 30, reply, activity);
  }
  return signal;
}

describe("live signal driver", () => {
  it("stays present and energetic through tool steps without moving the lips", () => {
    const steps: [number, number][] = Array.from({ length: 30 }, (_, i) => [-1, i * 40]);
    const signal = run(steps);
    expect(signal.presence).toBeGreaterThan(0.9);
    expect(signal.energy).toBeGreaterThan(0.5);
    expect(signal.open).toBe(0);
  });

  it("moves the lips while reply text streams", () => {
    const steps: [number, number][] = Array.from({ length: 30 }, (_, i) => [i * 20, i * 20]);
    expect(run(steps).open).toBeGreaterThan(0);
  });

  it("fades out once the turn ends", () => {
    const busy: [number, number][] = Array.from({ length: 30 }, (_, i) => [-1, i * 40]);
    const idle: [number, number][] = Array.from({ length: 90 }, () => [-1, -1]);
    const signal = run([...busy, ...idle]);
    expect(signal.presence).toBeLessThan(0.1);
    expect(signal.energy).toBeLessThan(0.05);
  });
});

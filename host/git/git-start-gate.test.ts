import { expect, it } from "vitest";
import { GitStartGate } from "./git-start-gate";

it("spaces process starts without waiting for earlier command completion", async () => {
  const gate = new GitStartGate(15);
  const times: number[] = [];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      await gate.enter();
      times.push(Date.now());
    }),
  );
  expect(times).toHaveLength(3);
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(10);
  expect(times[2] - times[1]).toBeGreaterThanOrEqual(10);
});

it("does not delay platforms that do not need process-start spacing", async () => {
  const gate = new GitStartGate(0);
  await Promise.all([gate.enter(), gate.enter(), gate.enter()]);
});

it("cancels a queued start without waiting for the previous spacing window", async () => {
  const gate = new GitStartGate(1000);
  await gate.enter();
  const controller = new AbortController();
  const queued = gate.enter(controller.signal);
  controller.abort(new Error("cancelled"));
  await expect(queued).rejects.toThrow("cancelled");
});

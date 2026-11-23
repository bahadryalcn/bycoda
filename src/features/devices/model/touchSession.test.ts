import { expect, it, vi } from "vitest";
import { createTouchSession, type TouchPhase, type TouchPoint } from "./touchSession";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const setup = (overrides: { gate?: () => boolean; after?: Promise<unknown> } = {}) => {
  const calls: Array<[TouchPhase, TouchPoint]> = [];
  const pending: Array<ReturnType<typeof deferred>> = [];
  const onFailure = vi.fn();
  const session = createTouchSession({
    start: { x: 0.1, y: 0.1 },
    after: overrides.after ?? Promise.resolve(),
    gate: overrides.gate ?? (() => true),
    send: (phase, point) => {
      calls.push([phase, point]);
      const request = deferred();
      pending.push(request);
      return request.promise;
    },
    onFailure,
  });
  const phases = () => calls.map(([phase]) => phase);
  const answer = async (index: number) => {
    pending[index]!.resolve();
    await flush();
  };
  return { session, calls, pending, phases, answer, onFailure };
};

it("sends down at once, merges moves behind one request and orders up last", async () => {
  const { session, calls, phases, answer } = setup();
  await flush();
  expect(phases()).toEqual(["down"]);
  session.move({ x: 0.2, y: 0.2 });
  session.move({ x: 0.3, y: 0.3 });
  await flush();
  expect(phases()).toEqual(["down"]);
  await answer(0);
  expect(calls[1]).toEqual(["move", { x: 0.3, y: 0.3 }]);
  session.move({ x: 0.4, y: 0.4 });
  session.move({ x: 0.5, y: 0.5 });
  session.end("up", { x: 0.6, y: 0.6 });
  await answer(1);
  // The pending move is dropped; the final position travels with up.
  expect(calls.slice(2)).toEqual([["up", { x: 0.6, y: 0.6 }]]);
  await answer(2);
  await expect(session.done).resolves.toBe(true);
  expect(session.closed).toBe(true);
});

it("sends a tap as down then up even when up arrives while down is in flight", async () => {
  const { session, phases, answer } = setup();
  await flush();
  session.end("up");
  await flush();
  expect(phases()).toEqual(["down"]);
  await answer(0);
  expect(phases()).toEqual(["down", "up"]);
  await answer(1);
  await expect(session.done).resolves.toBe(true);
});

it("sends nothing when cancelled or gated off before down", async () => {
  const gate = vi.fn(() => false);
  const gated = setup({ gate });
  await expect(gated.session.done).resolves.toBe(false);
  expect(gated.calls).toEqual([]);
  const blocker = deferred();
  const queued = setup({ after: blocker.promise });
  queued.session.end("cancel");
  blocker.resolve();
  await expect(queued.session.done).resolves.toBe(false);
  expect(queued.calls).toEqual([]);
});

it("waits for earlier input before down", async () => {
  const blocker = deferred();
  const { phases, session, answer } = setup({ after: blocker.promise });
  await flush();
  expect(phases()).toEqual([]);
  blocker.resolve();
  await flush();
  expect(phases()).toEqual(["down"]);
  session.end("cancel");
  await answer(0);
  expect(phases()).toEqual(["down", "cancel"]);
  await answer(1);
  await expect(session.done).resolves.toBe(false);
});

it("cancels after the request in flight and drops merged moves", async () => {
  const { session, phases, answer } = setup();
  await flush();
  await answer(0);
  session.move({ x: 0.2, y: 0.2 });
  await flush();
  session.move({ x: 0.3, y: 0.3 });
  session.end("cancel");
  session.end("up");
  session.move({ x: 0.9, y: 0.9 });
  await answer(1);
  expect(phases()).toEqual(["down", "move", "cancel"]);
  await answer(2);
  await expect(session.done).resolves.toBe(false);
});

it("reports a rejected request once, tries one best-effort cancel and closes", async () => {
  const { session, phases, pending, onFailure } = setup();
  await flush();
  pending[0]!.resolve();
  await flush();
  session.move({ x: 0.2, y: 0.2 });
  await flush();
  const failure = new Error("DEVICE_CONTROL_LEASE_INVALID");
  pending[1]!.reject(failure);
  await flush();
  expect(onFailure).toHaveBeenCalledTimes(1);
  expect(onFailure).toHaveBeenCalledWith(failure, "move");
  expect(phases()).toEqual(["down", "move", "cancel"]);
  pending[2]!.reject(new Error("also fails"));
  await expect(session.done).resolves.toBe(false);
  session.end("up");
  session.move({ x: 0.5, y: 0.5 });
  expect(phases()).toEqual(["down", "move", "cancel"]);
  expect(session.closed).toBe(true);
});

it("treats an uncertain down as failed and never sends move or up", async () => {
  const { session, phases, pending, onFailure } = setup();
  await flush();
  session.move({ x: 0.2, y: 0.2 });
  session.end("up");
  pending[0]!.reject(new Error("RPC_WS_DEADLINE"));
  await flush();
  expect(onFailure).toHaveBeenCalledWith(expect.any(Error), "down");
  expect(phases()).toEqual(["down", "cancel"]);
  pending[1]!.resolve();
  await expect(session.done).resolves.toBe(false);
});

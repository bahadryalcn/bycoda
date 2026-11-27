import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startLeaseHeartbeat } from "./leaseHeartbeat";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  messages: unknown[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("beats from the worker clock without any main-thread timer, and stops at once", () => {
  vi.stubGlobal("Worker", FakeWorker);
  const send = vi.fn();
  const stop = startLeaseHeartbeat(send, 15_000);
  const [worker] = FakeWorker.instances;
  expect(worker.messages).toEqual([{ type: "start", ms: 15_000 }]);
  // A throttled window never runs main-thread timers; the worker tick alone must reach send.
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(15_000);
  worker.onmessage?.();
  expect(send).toHaveBeenCalledTimes(1);
  // A tick backlog delivered right after a send is dropped, not replayed as a burst.
  worker.onmessage?.();
  worker.onmessage?.();
  expect(send).toHaveBeenCalledTimes(1);
  stop();
  expect(worker.terminated).toBe(true);
  vi.advanceTimersByTime(60_000);
  worker.onmessage?.();
  expect(send).toHaveBeenCalledTimes(1);
});

it("falls back to a plain interval when the worker fails and still stops cleanly", () => {
  vi.stubGlobal("Worker", FakeWorker);
  const send = vi.fn();
  const stop = startLeaseHeartbeat(send, 15_000);
  const [worker] = FakeWorker.instances;
  worker.onerror?.();
  expect(worker.terminated).toBe(true);
  vi.advanceTimersByTime(15_000);
  expect(send).toHaveBeenCalledTimes(1);
  stop();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(60_000);
  expect(send).toHaveBeenCalledTimes(1);
});

it("uses a plain interval where Workers do not exist", () => {
  vi.stubGlobal("Worker", undefined);
  const send = vi.fn();
  const stop = startLeaseHeartbeat(send, 25_000);
  vi.advanceTimersByTime(50_000);
  expect(send).toHaveBeenCalledTimes(2);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("never schedules faster than the one second floor", () => {
  vi.stubGlobal("Worker", FakeWorker);
  const stop = startLeaseHeartbeat(vi.fn(), 1);
  expect(FakeWorker.instances[0].messages).toEqual([{ type: "start", ms: 1_000 }]);
  stop();
});

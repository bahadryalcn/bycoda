// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCopyFeedback } from "./useCopyFeedback";

type Feedback = ReturnType<typeof useCopyFeedback>;
let root: Root;
let latest: Feedback;
const container = document.createElement("div");

function Probe({ keys }: { keys: readonly unknown[] }) {
  const feedback = useCopyFeedback({ resetKeys: keys, successMs: 1000 });
  // Publish the committed value to the test after render, not during it.
  useLayoutEffect(() => {
    latest = feedback;
  });
  return null;
}
function render(keys: readonly unknown[]) {
  act(() => root.render(createElement(Probe, { keys })));
}
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("starts one copy at a time and flashes the success for its duration", async () => {
  render(["a"]);
  const first = deferred();
  const run = vi.fn(() => first.promise);
  let started: boolean[] = [];
  act(() => {
    started = [latest.copy(run), latest.copy(run)];
  });
  expect(started).toEqual([true, false]);
  expect(run).toHaveBeenCalledTimes(1);
  expect(latest.pending).toBe(true);
  await act(async () => first.resolve());
  expect(latest.copied).toBe(true);
  act(() => vi.advanceTimersByTime(1000));
  expect(latest.status).toBe("idle");
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the error until retried and releases the lock", async () => {
  render(["a"]);
  const failing = deferred();
  act(() => void latest.copy(() => failing.promise));
  await act(async () => failing.reject(new Error("denied")));
  expect(latest.failed).toBe(true);
  expect(latest.error).toBe("denied");
  act(() => vi.advanceTimersByTime(60_000));
  expect(latest.failed).toBe(true);
  await act(async () => void latest.copy(() => Promise.resolve()));
  expect(latest.copied).toBe(true);
  expect(latest.error).toBeUndefined();
});

it("treats a synchronous throw as a failure", async () => {
  render(["a"]);
  await act(async () =>
    void latest.copy(() => {
      throw new Error("sync");
    }),
  );
  expect(latest.error).toBe("sync");
});

it("ignores a result that settles after the content identity changed", async () => {
  render(["a"]);
  const late = deferred();
  act(() => void latest.copy(() => late.promise));
  expect(latest.pending).toBe(true);
  render(["b"]);
  expect(latest.status).toBe("idle");
  await act(async () => late.resolve());
  expect(latest.status).toBe("idle");
  // The new content owns a fresh lock.
  const run = vi.fn(() => Promise.resolve());
  await act(async () => void latest.copy(run));
  expect(run).toHaveBeenCalledTimes(1);
  expect(latest.copied).toBe(true);
});

it("drops the confirmation when the content changes and leaves no timer after unmount", async () => {
  render(["a"]);
  await act(async () => void latest.copy(() => Promise.resolve()));
  expect(latest.copied).toBe(true);
  render(["b"]);
  expect(latest.status).toBe("idle");
  await act(async () => void latest.copy(() => Promise.resolve()));
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  root = createRoot(container);
});

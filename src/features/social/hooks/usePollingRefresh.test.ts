// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePollingRefresh } from "./usePollingRefresh";

const INTERVAL = 15_000;

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.useRealTimers();
});

type Load = (isCurrent: () => boolean) => Promise<void>;

function Probe(props: {
  active: boolean;
  scope: unknown;
  load: Load;
  onRefresh?: (refresh: () => Promise<void>) => void;
}) {
  const refresh = usePollingRefresh({
    active: props.active,
    scope: props.scope,
    intervalMs: INTERVAL,
    load: props.load,
  });
  props.onRefresh?.(refresh);
  return null;
}

function render(props: Parameters<typeof Probe>[0]) {
  return act(async () => {
    root.render(createElement(Probe, props));
  });
}

function advance(ms: number) {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it("does not read the Host while the screen is inactive", async () => {
  const load = vi.fn<Load>(async () => undefined);
  await render({ active: false, scope: "a", load });
  await advance(INTERVAL * 4);
  expect(load).not.toHaveBeenCalled();
});

it("reads at once when active and then at the normal cadence", async () => {
  const load = vi.fn<Load>(async () => undefined);
  await render({ active: true, scope: "a", load });
  expect(load).toHaveBeenCalledTimes(1);
  await advance(INTERVAL);
  expect(load).toHaveBeenCalledTimes(2);
});

it("waits longer after each failed read and returns to the normal cadence on success", async () => {
  let fail = true;
  const load = vi.fn<Load>(async () => {
    if (fail) throw new Error("offline");
  });
  await render({ active: true, scope: "a", load });
  expect(load).toHaveBeenCalledTimes(1);

  // One failure doubles the wait: 30 s before the next read, not 15 s.
  await advance(INTERVAL);
  expect(load).toHaveBeenCalledTimes(1);
  await advance(INTERVAL);
  expect(load).toHaveBeenCalledTimes(2);

  fail = false;
  await advance(INTERVAL * 4);
  const callsAfterRecovery = load.mock.calls.length;
  await advance(INTERVAL);
  expect(load.mock.calls.length).toBe(callsAfterRecovery + 1);
});

it("an explicit refresh runs now and resets the backoff once it succeeds", async () => {
  let fail = true;
  const load = vi.fn<Load>(async () => {
    if (fail) throw new Error("offline");
  });
  let refresh: (() => Promise<void>) | undefined;
  await render({
    active: true,
    scope: "a",
    load,
    onRefresh: (value) => (refresh = value),
  });
  await advance(INTERVAL * 2);
  const before = load.mock.calls.length;

  fail = false;
  await act(async () => {
    await refresh?.();
  });
  expect(load.mock.calls.length).toBe(before + 1);

  // Backoff is cleared: the next poll is back at the normal interval.
  await advance(INTERVAL);
  expect(load.mock.calls.length).toBe(before + 2);
});

it("drops a read still in flight when the scope changes, and restarts for the new scope", async () => {
  const seen: Array<() => boolean> = [];
  const load = vi.fn<Load>(async (isCurrent) => {
    seen.push(isCurrent);
  });
  await render({ active: true, scope: "a", load });
  const staleIsCurrent = seen[0];
  expect(staleIsCurrent?.()).toBe(true);

  await render({ active: true, scope: "b", load });
  expect(staleIsCurrent?.()).toBe(false);
  expect(load).toHaveBeenCalledTimes(2);
});

it("stops polling when the screen goes inactive", async () => {
  const load = vi.fn<Load>(async () => undefined);
  await render({ active: true, scope: "a", load });
  await render({ active: false, scope: "a", load });
  const calls = load.mock.calls.length;
  await advance(INTERVAL * 4);
  expect(load.mock.calls.length).toBe(calls);
});

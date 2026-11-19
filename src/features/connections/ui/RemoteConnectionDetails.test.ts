// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const life = vi.hoisted(() => ({
  value: {
    phase: "checking",
    startedAt: 0,
    nextRetryAt: undefined as number | undefined,
    paused: false,
    features: {},
    activity: [],
  } as Record<string, unknown>,
}));
vi.mock("../model/remoteLifecycle", () => ({
  useRemoteLifecycle: () => life.value,
}));

import { RemoteConnectionDetails } from "./RemoteConnectionDetails";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const draw = () =>
    act(async () => root.render(createElement(RemoteConnectionDetails, { environmentId: "env" })));
  await draw();
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, draw };
}

const START = new Date("2026-11-19T10:00:00Z").getTime();

const liveRegion = (container: HTMLElement) =>
  container.querySelector('[role="status"]') as HTMLElement;

it("keeps the elapsed counter visible but out of the live region", async () => {
  life.value = { ...life.value, phase: "checking", startedAt: START };
  const { container } = await render();
  expect(liveRegion(container).textContent).toBe("Checking Host");

  await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));

  // The counter is still shown to sighted users...
  expect(container.textContent).toContain("3s elapsed");
  // ...but the live region only carries the phase, so it does not re-announce each second.
  expect(liveRegion(container).textContent).toBe("Checking Host");
  expect(liveRegion(container).contains(container.querySelector(".tabular-nums"))).toBe(false);
});

it("keeps the retry countdown visible but out of the live region", async () => {
  life.value = {
    ...life.value,
    phase: "waiting",
    startedAt: undefined,
    nextRetryAt: START + 10_000,
  };
  const { container } = await render();
  expect(liveRegion(container).textContent).toBe("Waiting for you");

  await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));

  expect(container.textContent).toContain("Retry in 8s");
  expect(liveRegion(container).textContent).toBe("Waiting for you");
});

it("updates the live region when the phase really changes", async () => {
  life.value = { ...life.value, phase: "checking", startedAt: START };
  const { container, draw } = await render();
  expect(liveRegion(container).textContent).toBe("Checking Host");

  life.value = { ...life.value, phase: "ready", startedAt: undefined };
  await draw();

  expect(liveRegion(container).textContent).toBe("Host verified");
});

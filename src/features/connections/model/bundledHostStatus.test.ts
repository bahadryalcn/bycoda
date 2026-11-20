// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  value: null as unknown,
  hidden: { current: false },
  polls: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    if (command !== "local_host_bundle_status") return null;
    fake.polls();
    return fake.value;
  },
}));

import { bundledHostWaitsForSessions, useBundledHostStatus } from "./bundledHostStatus";

function Consumer() {
  const status = useBundledHostStatus();
  return createElement("span", null, status?.state ?? "none");
}

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  fake.value = null;
  fake.hidden.current = false;
  vi.useRealTimers();
  // Restores the browser's own `document.hidden` getter.
  delete (document as { hidden?: boolean }).hidden;
});

function setHidden(hidden: boolean) {
  fake.hidden.current = hidden;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => fake.hidden.current,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function mount(count: number) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  const consumers = Array.from({ length: count }, () => createElement(Consumer));
  await act(async () => root.render(createElement("div", null, ...consumers)));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  };
  return container;
}

it("shares one native poll across consumers and pauses while the document is hidden", async () => {
  vi.useFakeTimers();
  fake.value = { state: "current" };
  fake.polls.mockClear();
  await mount(3);
  expect(fake.polls).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(fake.polls).toHaveBeenCalledTimes(2);

  await act(async () => setHidden(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fake.polls).toHaveBeenCalledTimes(2);

  await act(async () => setHidden(false));
  expect(fake.polls).toHaveBeenCalledTimes(3);
});

it("refreshes on focus only while visible", async () => {
  vi.useFakeTimers();
  fake.value = { state: "current" };
  fake.polls.mockClear();
  await mount(1);
  expect(fake.polls).toHaveBeenCalledTimes(1);

  await act(async () => setHidden(true));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(fake.polls).toHaveBeenCalledTimes(1);

  await act(async () => setHidden(false));
  expect(fake.polls).toHaveBeenCalledTimes(2);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(fake.polls).toHaveBeenCalledTimes(3);
});

it("stops the poller when the last consumer unmounts", async () => {
  vi.useFakeTimers();
  fake.value = { state: "current" };
  fake.polls.mockClear();
  await mount(2);
  cleanup?.();
  cleanup = undefined;
  fake.polls.mockClear();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(fake.polls).not.toHaveBeenCalled();
});

it("waits for sessions by the native reason, not by the display message", () => {
  expect(
    bundledHostWaitsForSessions({
      state: "deferred",
      message: "Reworded or localized text.",
      reason: "waiting-for-sessions",
    }),
  ).toBe(true);
  expect(
    bundledHostWaitsForSessions({
      state: "deferred",
      message: "The host update waits until running sessions finish.",
    }),
  ).toBe(false);
  expect(
    bundledHostWaitsForSessions({
      state: "current",
      reason: "waiting-for-sessions",
    }),
  ).toBe(false);
  expect(bundledHostWaitsForSessions(null)).toBe(false);
});

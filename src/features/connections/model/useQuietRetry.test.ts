// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QUIET_RETRY_DELAYS_MS, useQuietRetry } from "./useQuietRetry";

const BUSY = "Host rejected request: Host read capacity is busy; retry later.";
let hidden: boolean[] = [];
function Probe({ error, retry }: { error?: string; retry?: () => void }) {
  hidden.push(useQuietRetry(error, retry));
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hidden = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(props: { error?: string; retry?: () => void }) {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe, props)));
  return {
    render: (next: { error?: string; retry?: () => void }) =>
      act(async () => root.render(createElement(Probe, next))),
    unmount: () => act(async () => root.unmount()),
  };
}

it("retries a busy machine quietly, then reports it after the last retry", async () => {
  const retry = vi.fn();
  const view = await mount({ error: BUSY, retry });
  expect(hidden.at(-1)).toBe(true);
  for (const delay of QUIET_RETRY_DELAYS_MS) {
    await act(async () => vi.advanceTimersByTime(delay));
  }
  expect(retry).toHaveBeenCalledTimes(QUIET_RETRY_DELAYS_MS.length);
  expect(hidden.at(-1)).toBe(false);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(retry).toHaveBeenCalledTimes(QUIET_RETRY_DELAYS_MS.length);
  await view.unmount();
});

it("shows other failures at once and starts over after a success", async () => {
  const retry = vi.fn();
  const view = await mount({ error: "Project is not registered on this machine", retry });
  expect(hidden.at(-1)).toBe(false);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(retry).not.toHaveBeenCalled();
  await view.render({ error: BUSY, retry });
  await act(async () => vi.advanceTimersByTime(QUIET_RETRY_DELAYS_MS[0]));
  expect(retry).toHaveBeenCalledOnce();
  await view.render({ retry });
  await act(async () => vi.advanceTimersByTime(1));
  await view.render({ error: BUSY, retry });
  expect(hidden.at(-1)).toBe(true);
  await act(async () => vi.advanceTimersByTime(QUIET_RETRY_DELAYS_MS[0]));
  expect(retry).toHaveBeenCalledTimes(2);
  await view.unmount();
});

it("does not hide a busy failure that nothing can retry", async () => {
  const view = await mount({ error: BUSY });
  expect(hidden.at(-1)).toBe(false);
  await view.unmount();
});

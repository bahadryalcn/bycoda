// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeviceFrameState } from "./DeviceFrameState";
import type { DeviceFrame } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const capturedAt = "2026-11-04T12:00:00.000Z";
const frame: DeviceFrame = { mime: "image/png", base64: "x", capturedAt };
const baseProps = {
  frame,
  shownFrame: frame,
  live: true,
  streaming: false,
  visible: true,
  annotating: false,
  frameStale: false,
  captureFailed: false,
  connectionUnavailable: false,
};

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(capturedAt));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setHidden(false);
  vi.useRealTimers();
});

it("ticks the captured age inside the label without re-rendering its parent", async () => {
  let parentRenders = 0;
  const Parent = ({ children }: { children: ReactNode }) => {
    parentRenders += 1;
    return children;
  };
  await act(async () =>
    root.render(createElement(Parent, null, createElement(DeviceFrameState, baseProps))),
  );
  const rendersAfterMount = parentRenders;
  expect(container.querySelector(".device-panel-frame-state")).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  const state = container.querySelector(".device-panel-frame-state")!;
  expect(state.textContent).toContain("Last frame · Refreshing");
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(state.textContent).toContain("8 sec");
  expect(parentRenders).toBe(rendersAfterMount);
});

it("stops the timer while the document is hidden and refreshes when it returns", async () => {
  await act(async () => root.render(createElement(DeviceFrameState, baseProps)));
  await act(async () => setHidden(true));
  expect(vi.getTimerCount()).toBe(0);
  vi.setSystemTime(new Date(Date.parse(capturedAt) + 20_000));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(container.querySelector(".device-panel-frame-state")).toBeNull();
  await act(async () => setHidden(false));
  expect(container.querySelector(".device-panel-frame-state")?.textContent).toContain(
    "Last frame · Refreshing",
  );
});

it("keeps no timer while streaming or while the panel is hidden", async () => {
  await act(async () => root.render(createElement(DeviceFrameState, { ...baseProps, streaming: true })));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => root.render(createElement(DeviceFrameState, { ...baseProps, visible: false })));
  expect(vi.getTimerCount()).toBe(0);
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationVisibility } from "./presentationVisibility";
import { SessionWorkingStatus } from "./SessionWorkingStatus";

vi.mock("./TerminalSpinner", () => ({ TerminalSpinner: () => null }));

const START = 1_000_000;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START + 5_000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = (visible: boolean) =>
  act(() =>
    root.render(
      createElement(
        PresentationVisibility.Provider,
        { value: visible },
        createElement(SessionWorkingStatus, { startedAt: START }),
      ),
    ),
  );
const label = () =>
  container.querySelector("[data-session-working-status]")?.getAttribute("aria-label");

describe("session working status clock", () => {
  it("counts up once a second while its pane is shown", () => {
    render(true);
    expect(label()).toContain("5s");
    act(() => vi.advanceTimersByTime(3_000));
    expect(label()).toContain("8s");
  });

  // perf P16: gate the shared 1 s ticker on presentation visibility.
  it("keeps no running timer while its pane is hidden", () => {
    render(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases its timer when unmounted", () => {
    render(true);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });

  it("shows the current elapsed time again when a hidden pane is shown", () => {
    render(false);
    act(() => vi.advanceTimersByTime(10_000));
    render(true);
    expect(label()).toContain("15s");
  });
});

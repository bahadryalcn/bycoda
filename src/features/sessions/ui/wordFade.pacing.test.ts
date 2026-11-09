// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVEAL_MAX_BACKLOG, usePacedText } from "./wordFade";
let root: Root;
let host: HTMLDivElement;
function renderHook(initial: { text: string; streaming: boolean }) {
  const result = { current: { text: "", revealing: false } };
  function Probe(props: typeof initial) {
    result.current = usePacedText(props.text, props.streaming);
    return null;
  }
  const rerender = (props: typeof initial) => act(() => root.render(createElement(Probe, props)));
  rerender(initial);
  return { result, rerender };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  localStorage.removeItem("bycoda-low-latency-text");
});
describe("reveal cadence", () => {
  it("re-renders a streaming reply at about 24 Hz on a 60 Hz display", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      let renders = 0;
      const text = "word ".repeat(300);
      function Probe() {
        renders++;
        usePacedText(text, true);
        return null;
      }
      act(() => root.render(createElement(Probe)));
      renders = 0;
      act(() => {
        vi.advanceTimersByTime(400);
      });
      // 400 ms of 16 ms frames would render ~25 times ungated; the gate allows ~10.
      expect(renders).toBeGreaterThan(0);
      expect(renders).toBeLessThanOrEqual(11);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("bounded pacing", () => {
  it("shows a large burst and a completed response immediately", () => {
    const { result, rerender } = renderHook({ text: "", streaming: true });
    const burst = "x".repeat(REVEAL_MAX_BACKLOG + 1);
    rerender({ text: burst, streaming: true });
    expect(result.current.text).toBe(burst);
    rerender({ text: `${burst} done`, streaming: false });
    expect(result.current.text).toBe(`${burst} done`);
    expect(result.current.revealing).toBe(false);
  });
  it("bypasses pacing for reduced motion and local low-latency preference", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { result, rerender } = renderHook({ text: "", streaming: true });
    rerender({ text: "instant", streaming: true });
    expect(result.current.text).toBe("instant");
    localStorage.setItem("bycoda-low-latency-text", "true");
    act(() => window.dispatchEvent(new Event("storage")));
    rerender({ text: "instant text", streaming: true });
    expect(result.current.text).toBe("instant text");
  });
});

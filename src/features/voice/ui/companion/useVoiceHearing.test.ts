// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VOICE_HEARING_SAMPLE_MS } from "../../model/voicePresentationTimers";
import { useVoiceHearing } from "./useVoiceHearing";

let root: Root;
let container: HTMLDivElement;
let renders = 0;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  renders = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Probe(props: { level: { current: number }; active: boolean }) {
  renders += 1;
  const hearing = useVoiceHearing(props.level, props.active);
  return createElement("span", { "data-hearing": String(hearing) });
}
const hearing = () => container.querySelector("span")?.getAttribute("data-hearing");

// Regression #318: a streaming input level must not re-render the panel that reads it.
it("re-renders only when hearing flips, not for each level value", () => {
  const level = { current: 0 };
  act(() => root.render(createElement(Probe, { level, active: true })));
  const initial = renders;
  expect(hearing()).toBe("false");

  for (const value of [0.1, 0.4, 0.2, 0.9, 0.3]) {
    level.current = value;
    act(() => vi.advanceTimersByTime(VOICE_HEARING_SAMPLE_MS));
  }
  expect(hearing()).toBe("true");
  expect(renders).toBe(initial + 1);

  level.current = 0;
  act(() => vi.advanceTimersByTime(VOICE_HEARING_SAMPLE_MS));
  expect(hearing()).toBe("false");
  expect(renders).toBe(initial + 2);
});

it("reports silence and runs no timer while inactive", () => {
  const level = { current: 0.9 };
  act(() => root.render(createElement(Probe, { level, active: false })));
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(VOICE_HEARING_SAMPLE_MS * 5));
  expect(hearing()).toBe("false");

  act(() => root.render(createElement(Probe, { level, active: true })));
  act(() => vi.advanceTimersByTime(VOICE_HEARING_SAMPLE_MS));
  expect(hearing()).toBe("true");

  act(() => root.render(createElement(Probe, { level, active: false })));
  expect(hearing()).toBe("false");
  expect(vi.getTimerCount()).toBe(0);
});

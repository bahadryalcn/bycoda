// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LIVE_BACKGROUNDS } from "../../../model/liveBackground";
import { SceneStrip } from "./SceneStrip";

const state = vi.hoisted(() => ({ motion: true }));
vi.mock("../../../model/decorativeMotion", () => ({
  useDecorativeMotionEnabled: () => state.motion,
}));
vi.mock("../../LiveBackgroundCanvas", () => ({
  LiveBackgroundCanvas: ({ still }: { still: boolean }) =>
    createElement("span", { "data-still": String(still) }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", undefined);
  state.motion = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("navigates and selects scenes using radio keys", () => {
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(SceneStrip, { value: LIVE_BACKGROUNDS[0]!, onChange, label: "Scenes" }),
    ),
  );
  const buttons = host.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  act(() =>
    buttons[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(onChange).toHaveBeenCalledWith(LIVE_BACKGROUNDS[1]);
  expect(document.activeElement).toBe(buttons[1]);
});

it("never plays a preview when decorative motion is disabled", () => {
  state.motion = false;
  act(() =>
    root.render(
      createElement(SceneStrip, {
        value: LIVE_BACKGROUNDS[0]!,
        onChange: vi.fn(),
        label: "Scenes",
      }),
    ),
  );
  const button = host.querySelectorAll<HTMLButtonElement>('[role="radio"]')[1]!;
  act(() => button.focus());
  expect(host.querySelector('[data-still="false"]')).toBeNull();
});

it("stops a focused preview after a few seconds", () => {
  act(() =>
    root.render(
      createElement(SceneStrip, {
        value: LIVE_BACKGROUNDS[0]!,
        onChange: vi.fn(),
        label: "Scenes",
      }),
    ),
  );
  const button = host.querySelectorAll<HTMLButtonElement>('[role="radio"]')[1]!;
  act(() => button.focus());
  expect(button.querySelector('[data-still="false"]')).not.toBeNull();
  act(() => vi.advanceTimersByTime(4000));
  expect(button.querySelector('[data-still="false"]')).toBeNull();
});

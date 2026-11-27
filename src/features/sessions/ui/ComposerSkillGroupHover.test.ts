// @vitest-environment happy-dom
import { act, createElement, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerSkillGroupHover, type ComposerSkillGroup } from "./ComposerSkillGroupHover";

let host: HTMLDivElement;
let wrap: HTMLDivElement;
let root: Root;
let frames: FrameRequestCallback[];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Frames run only when a test flushes them, so pointer moves can be coalesced on demand.
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  host = document.createElement("div");
  wrap = document.createElement("div");
  document.body.append(host, wrap);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  wrap.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function flushFrames() {
  const pending = frames;
  frames = [];
  act(() => pending.forEach((callback) => callback(0)));
}

function pointerMove(target: EventTarget, clientX: number, clientY: number) {
  target.dispatchEvent(new MouseEvent("pointermove", { clientX, clientY }));
}

function mount(groups: ReadonlyMap<string, ComposerSkillGroup>) {
  const field = document.createElement("textarea");
  const chip = document.createElement("span");
  chip.dataset.composerSkillGroup = "review";
  chip.dataset.composerSkillGroupPrefix = "/";
  const getClientRects = vi.fn(() => [{ left: 0, top: 0, right: 100, bottom: 20 }]);
  chip.getClientRects = getClientRects as unknown as () => DOMRectList;
  wrap.append(field, chip);
  const ref = { current: field } as RefObject<HTMLTextAreaElement>;
  act(() => root.render(createElement(ComposerSkillGroupHover, { field: ref, groups })));
  return { field, getClientRects };
}

const groups = new Map([["review", { name: "Review", members: ["a", "b"] }]]);

it("reads group token rects once for a burst of pointer moves in one frame", () => {
  const { field, getClientRects } = mount(groups);
  for (let index = 0; index < 50; index += 1) pointerMove(field, 5, 5);
  flushFrames();
  expect(getClientRects).toHaveBeenCalledTimes(1);

  for (let index = 0; index < 50; index += 1) pointerMove(field, 5, 5);
  flushFrames();
  expect(getClientRects).toHaveBeenCalledTimes(1);
});

it("reads the rects again after the textarea scrolls", () => {
  const { field, getClientRects } = mount(groups);
  pointerMove(field, 5, 5);
  flushFrames();
  field.dispatchEvent(new Event("scroll"));
  pointerMove(field, 5, 5);
  flushFrames();
  expect(getClientRects).toHaveBeenCalledTimes(2);
});

it("reads the rects again after the draft re-renders", () => {
  const { field, getClientRects } = mount(groups);
  pointerMove(field, 5, 5);
  flushFrames();
  act(() =>
    root.render(
      createElement(ComposerSkillGroupHover, {
        field: { current: field } as RefObject<HTMLTextAreaElement>,
        groups: new Map(groups),
      }),
    ),
  );
  pointerMove(field, 5, 5);
  flushFrames();
  expect(getClientRects).toHaveBeenCalledTimes(2);
});

it("drops a pending hit test when the pointer leaves the textarea", () => {
  const { field, getClientRects } = mount(groups);
  pointerMove(field, 5, 5);
  field.dispatchEvent(new Event("pointerleave"));
  flushFrames();
  expect(getClientRects).not.toHaveBeenCalled();
});

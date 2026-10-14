// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useDismissPopover } from "./useDismissPopover";

it("Escape odağını sonraki karede verir ve unmount sırasında kareyi iptal eder", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame));
  const button = document.createElement("button");
  const focus = vi.spyOn(button, "focus");
  const setOpen = vi.fn();
  let dismiss!: (reason: string) => void;
  const trigger = { current: button };
  const root = createRoot(document.createElement("div"));
  function Probe() {
    dismiss = useDismissPopover(setOpen, trigger);
    return null;
  }
  act(() => root.render(createElement(Probe)));
  act(() => dismiss("outside"));
  expect(frames.size).toBe(0);
  expect(focus).not.toHaveBeenCalled();
  act(() => dismiss("escape"));
  expect(setOpen).toHaveBeenCalledWith(false);
  expect(focus).not.toHaveBeenCalled();
  frames.get(id)!(0);
  frames.delete(id);
  expect(focus).toHaveBeenCalledTimes(1);
  act(() => dismiss("escape"));
  expect(frames.size).toBe(1);
  act(() => root.unmount());
  expect(frames.size).toBe(0);
  vi.unstubAllGlobals();
});

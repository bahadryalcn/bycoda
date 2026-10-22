// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SettingsSearch } from "./SettingsSearch";
import { searchSettings } from "../model/settings";

it("preserves domain search ranking and reveals only after the launcher has closed on the next frame", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const reveal = vi.fn();
  try {
    await act(async () => root.render(createElement(SettingsSearch, { onReveal: reveal })));
    await act(async () => container.querySelector("button")!.click());
    const input = container.querySelector("input")!;
    const expected = searchSettings("font");
    expect(expected.length).toBeGreaterThan(0);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "font",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options).toHaveLength(expected.length);
    options.forEach((option, index) => expect(option.textContent).toContain(expected[index].label));
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(reveal).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    const pending = [...frames.values()];
    frames.clear();
    await act(async () => pending.forEach((callback) => callback(performance.now())));
    expect(reveal).toHaveBeenCalledExactlyOnceWith(expected[0].section, expected[0].settingId);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    vi.unstubAllGlobals();
  }
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AngleDial } from "./AngleDial";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("adjusts one degree or fifteen with shift and exposes its value", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  try {
    await act(async () => root.render(createElement(AngleDial, { value: 166, onChange: change })));
    const dial = host.querySelector<HTMLElement>('[role="slider"]')!;
    expect(dial.getAttribute("aria-valuetext")).toBe("166°");
    await act(async () =>
      dial.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(change).toHaveBeenLastCalledWith(167);
    await act(async () =>
      dial.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true }),
      ),
    );
    expect(change).toHaveBeenLastCalledWith(151);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

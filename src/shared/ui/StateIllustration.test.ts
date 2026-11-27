// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { StateIllustration } from "./StateIllustration";

it("sizes the box from the scene aspect and uses a frame url for every scene", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "matchMedia",
    vi
      .fn()
      .mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    for (const name of ["error", "offline", "chat-empty"] as const) {
      await act(async () => root.render(createElement(StateIllustration, { name, size: "panel" })));
      const img = container.querySelector("img")!;
      expect(img.getAttribute("src")).toBeTruthy();
      expect(img.style.blockSize).toBe("96px");
    }
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("rests on the first frame while the app's decorative motion is off", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "matchMedia",
    vi
      .fn()
      .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
  document.documentElement.dataset.decorativeMotion = "off";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(StateIllustration, { name: "error" })));
    const rest = container.querySelector("img")!.getAttribute("src");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(container.querySelector("img")!.getAttribute("src")).toBe(rest);
  } finally {
    act(() => root.unmount());
    container.remove();
    delete document.documentElement.dataset.decorativeMotion;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

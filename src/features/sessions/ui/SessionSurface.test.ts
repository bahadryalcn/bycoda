// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionSurface } from "./SessionSurface";

it("moves the same mounted composer between the dock and its hidden host without losing input", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const dock = document.createElement("div");
  document.body.append(container, dock);
  const root = createRoot(container);
  const render = (host?: HTMLElement) =>
    root.render(
      createElement(SessionSurface, {
        host,
        children: createElement("textarea", { defaultValue: "Draft" }),
      }),
    );
  try {
    await act(async () => render(dock));
    const composer = dock.querySelector("textarea")!;
    composer.value = "Unsent text";
    await act(async () => render());
    expect(container.querySelector("textarea")).toBe(composer);
    await act(async () => render(dock));
    expect(dock.querySelector("textarea")).toBe(composer);
    expect(composer.value).toBe("Unsent text");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dock.remove();
    vi.unstubAllGlobals();
  }
});

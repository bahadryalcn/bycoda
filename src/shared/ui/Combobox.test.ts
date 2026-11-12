// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Combobox } from "./Combobox";

const resize = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock("../lib/observeResize", () => ({ observeResize: resize.subscribe }));
vi.mock("./Popover", () => ({
  popupListClassName: "",
  Popover: ({ minWidth, children }: { minWidth: number; children: React.ReactNode }) =>
    createElement("div", { "data-menu-min-width": minWidth }, children),
}));

it("measures the menu anchor after opening and follows its resize until dismissal", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const unobserve = vi.fn();
  resize.subscribe.mockReturnValue(unobserve);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(Combobox, {
          label: "Model",
          options: [{ value: "alpha", label: "Alpha" }],
        }),
      ),
    );
    const input = container.querySelector("input")!;
    const anchor = input.parentElement!;
    let width = 180;
    Object.defineProperty(anchor, "offsetWidth", { configurable: true, get: () => width });
    await act(async () => input.focus());
    expect(
      container.querySelector("[data-menu-min-width]")?.getAttribute("data-menu-min-width"),
    ).toBe("180");
    expect(resize.subscribe).toHaveBeenCalledWith(anchor, expect.any(Function));
    width = 240;
    await act(async () => resize.subscribe.mock.calls.at(-1)![1]());
    expect(
      container.querySelector("[data-menu-min-width]")?.getAttribute("data-menu-min-width"),
    ).toBe("240");
    await act(async () => container.querySelector<HTMLElement>('[role="option"]')!.click());
    expect(container.querySelector("[data-menu-min-width]")).toBeNull();
    expect(unobserve).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DropdownMenu } from "./DropdownMenu";

const resize = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock("../lib/observeResize", () => ({ observeResize: resize.subscribe }));
vi.mock("./Popover", () => ({
  popupListClassName: "",
  Popover: ({ minWidth, children }: { minWidth: number; children: React.ReactNode }) =>
    createElement("div", { "data-menu-min-width": minWidth }, children),
}));

const items = [{ kind: "item" as const, id: "copy", label: "Copy" }];

it("reads the content-width anchor outside render and follows its resize while open", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const unobserve = vi.fn();
  resize.subscribe.mockReset().mockReturnValue(unobserve);
  const container = document.createElement("div");
  const anchor = document.createElement("button");
  document.body.append(container, anchor);
  const root = createRoot(container);
  const measured = vi
    .spyOn(anchor, "getBoundingClientRect")
    .mockReturnValue({ width: 300 } as DOMRect);
  const minWidth = () =>
    container.querySelector("[data-menu-min-width]")?.getAttribute("data-menu-min-width");
  const render = (label: string) =>
    act(async () =>
      root.render(
        createElement(DropdownMenu, {
          anchor,
          label,
          items,
          width: "content",
          onPick: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
  try {
    await render("Actions");
    // Initial sizing: the first paint already uses the measured trigger width.
    expect(minWidth()).toBe("300");
    expect(resize.subscribe).toHaveBeenCalledWith(anchor, expect.any(Function));
    const readsAfterOpen = measured.mock.calls.length;

    // Re-rendering for unrelated state (same anchor and width) must not read layout again.
    await render("Actions again");
    await render("Actions once more");
    expect(measured.mock.calls.length).toBe(readsAfterOpen);
    expect(resize.subscribe).toHaveBeenCalledTimes(1);

    // Anchor resize while open updates the minimum width through the shared observer.
    measured.mockReturnValue({ width: 420 } as DOMRect);
    await act(async () => resize.subscribe.mock.calls.at(-1)![1]());
    expect(minWidth()).toBe("420");

    await act(async () => root.render(null));
    expect(unobserve).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    anchor.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps a fixed numeric width without measuring or observing the anchor", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resize.subscribe.mockReset();
  const container = document.createElement("div");
  const anchor = document.createElement("button");
  document.body.append(container, anchor);
  const root = createRoot(container);
  const measured = vi.spyOn(anchor, "getBoundingClientRect");
  try {
    await act(async () =>
      root.render(
        createElement(DropdownMenu, {
          anchor,
          label: "Fixed",
          items,
          width: 240,
          onPick: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    const rendered = container.querySelector("[data-menu-min-width]");
    expect(rendered?.getAttribute("data-menu-min-width")).toBe("240");
    expect(measured).not.toHaveBeenCalled();
    expect(resize.subscribe).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    anchor.remove();
    vi.unstubAllGlobals();
  }
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BrowserViewportControls } from "./BrowserViewportControls";

it("uses supported dimensions for rotate and custom resize, without resizing while disabled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onResize = vi.fn();
  const render = (disabled: boolean, width = 1280, height = 720) =>
    act(async () =>
      root.render(
        createElement(BrowserViewportControls, {
          viewport: { width, height },
          disabled,
          disabledReason: "View only",
          onResize,
        }),
      ),
    );
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find(
      (item) => item.getAttribute("aria-label") === label || item.textContent === label,
    )!;
  const edit = async (label: string, value: string) =>
    act(async () => {
      const input = container.querySelectorAll<HTMLInputElement>('form input[type="number"]')[
        label === "Width" ? 0 : 1
      ]!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  try {
    await render(false);
    await act(async () => button("Rotate viewport").click());
    expect(onResize).toHaveBeenLastCalledWith({ width: 720, height: 1280 });
    await edit("Width", "2561");
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onResize).toHaveBeenCalledTimes(1);
    await edit("Width", "900");
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onResize).toHaveBeenLastCalledWith({ width: 900, height: 720 });
    await render(true);
    await act(async () => button("Rotate viewport").click());
    expect(onResize).toHaveBeenCalledTimes(2);
    await render(false, 2560, 720);
    expect(button("Rotate viewport").getAttribute("aria-disabled")).toBe("true");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

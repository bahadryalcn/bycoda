// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WORKSPACE_BACKGROUND_DEFAULT } from "../../../model/workspaceBackground";
import { GradientStrip } from "./GradientStrip";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("opens a color stop and changes only the colors field", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(GradientStrip, { value: WORKSPACE_BACKGROUND_DEFAULT, onChange: change }),
      ),
    );
    const stop = host.querySelector<HTMLButtonElement>('button[aria-label="Color 1"]')!;
    await act(async () => stop.click());
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Hex color"]')!;
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "#123456");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(change).toHaveBeenCalledWith({
      colors: ["#123456", ...WORKSPACE_BACKGROUND_DEFAULT.colors.slice(1)],
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

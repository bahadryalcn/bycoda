// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Button } from "./button";

it("replaces action labels immediately and preserves the focused pending action", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const click = vi.fn();
  try {
    await act(async () => root.render(createElement(Button, { onClick: click }, "Save")));
    const button = container.querySelector("button")!;
    button.focus();
    for (const label of ["Save all pending changes", "Retry", "İşlemi yeniden dene"]) {
      await act(async () => root.render(createElement(Button, { onClick: click }, label)));
      expect(container.querySelector("button")).toBe(button);
      expect(button.textContent).toBe(label);
      expect(document.activeElement).toBe(button);
    }
    await act(async () => root.render(createElement(Button, { loading: true, onClick: click }, "İşlemi yeniden dene")));
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    button.click();
    expect(click).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(Button, { onClick: click }, "Retry")));
    expect(button.textContent).toBe("Retry");
    button.click();
    expect(click).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { GraphSearchInput } from "./GitGraphParts";

afterEach(() => {
  vi.unstubAllGlobals();
});

// #1248: Escape that dismisses an IME candidate must not close the graph search.
it("ignores Escape during IME composition and handles a plain Escape", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  const onEscape = vi.fn();
  try {
    act(() =>
      root.render(createElement(GraphSearchInput, { value: "", onChange: vi.fn(), onEscape })),
    );
    const input = mount.querySelector("input")!;
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true }),
      );
    });
    expect(onEscape).not.toHaveBeenCalled();
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onEscape).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    mount.remove();
  }
});

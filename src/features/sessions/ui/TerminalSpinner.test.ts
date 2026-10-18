// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TerminalSpinner } from "./TerminalSpinner";

it("renders the shared signal without a JavaScript animation timer or duplicate accessible status", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const interval = vi.spyOn(window, "setInterval");
  try {
    act(() => root.render(createElement(TerminalSpinner, { className: "w-3 text-active" })));
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')?.className).toContain("w-3 text-active");
    expect(container.querySelector("[role=status]")).toBeNull();
    expect(interval).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    interval.mockRestore();
    vi.unstubAllGlobals();
  }
});

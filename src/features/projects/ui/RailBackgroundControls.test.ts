// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RailBackgroundControls } from "./RailBackgroundControls";

it("exposes both background controls immediately and preserves the other surface", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  const body = { color: "#123456", opacity: 25 };
  try {
    act(() =>
      root.render(
        createElement(RailBackgroundControls, {
          value: { body },
          color: "#654321",
          group: true,
          onChange,
        }),
      ),
    );
    expect(container.querySelector("button[aria-controls]")).toBeNull();
    const checks = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checks).toHaveLength(2);
    expect(container.textContent).toContain("Group header");
    expect(container.textContent).toContain("Expanded contents");
    act(() => checks[0].click());
    expect(onChange).toHaveBeenLastCalledWith({ body, header: { color: "#654321", opacity: 15 } });
    act(() => checks[1].click());
    expect(onChange).toHaveBeenLastCalledWith({ body: undefined });
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

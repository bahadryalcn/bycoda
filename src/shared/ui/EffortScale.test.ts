// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { EffortScale } from "./EffortScale";

it("fills ordered bars, retains long accessible labels and supports keyboard selection and disabled state", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const change = vi.fn();
  const options = [
    { value: "", label: "Automatic inherited from global settings", icon: createElement("svg") },
    { value: "low", label: "Low" },
    { value: "high", label: "A very long translated high effort label" },
    { value: "ultra", label: "Ultra" },
  ];
  const render = (value: string, disabled = false) =>
    act(async () =>
      root.render(
        createElement(EffortScale, {
          options,
          value,
          disabled,
          label: "Effort",
          onValueChange: change,
        }),
      ),
    );
  try {
    await render("high");
    const radios = [...node.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios).toHaveLength(4);
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual(
      options.map((option) => option.label),
    );
    expect(radios.map((radio) => radio.hasAttribute("data-filled"))).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(radios.every((radio) => radio.textContent === "")).toBe(true);
    expect(node.textContent).toContain(options[2].label);
    await act(async () =>
      radios[2].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    );
    expect(change).toHaveBeenLastCalledWith("ultra");
    expect(document.activeElement).toBe(radios[3]);
    await act(async () => radios[0].click());
    expect(change).toHaveBeenLastCalledWith("");
    await render("");
    expect(node.querySelectorAll("[data-filled]")).toHaveLength(0);
    expect(node.textContent).toContain(options[0].label);
    await render("", true);
    expect(
      [...node.querySelectorAll<HTMLButtonElement>('[role="radio"]')].every(
        (radio) => radio.disabled,
      ),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});

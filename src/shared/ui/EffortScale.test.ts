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
    expect(radios).toHaveLength(3);
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual(
      options.map((option) => option.label),
    );
    expect(radios.map((radio) => radio.hasAttribute("data-filled"))).toEqual([true, true, false]);
    expect(radios.every((radio) => radio.textContent === "")).toBe(true);
    expect(node.textContent).toContain(options[1].label);
    expect(node.querySelector('[role="switch"]')).toBeNull();
    await act(async () =>
      radios[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    );
    expect(change).toHaveBeenLastCalledWith("ultra");
    expect(document.activeElement).toBe(radios[2]);
    await act(async () => radios[0].click());
    expect(change).toHaveBeenLastCalledWith("low");
    await render("", true);
    expect(node.querySelectorAll("[data-filled]")).toHaveLength(0);
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

it("can drop the visible label when a row already names the scale", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () =>
      root.render(
        createElement(EffortScale, {
          options: [
            { value: "low", label: "Low" },
            { value: "high", label: "High" },
          ],
          value: "high",
          label: "Subagent max effort",
          showLabel: false,
          onValueChange: vi.fn(),
        }),
      ),
    );
    expect(node.textContent).not.toContain("Subagent max effort");
    expect(node.textContent).toContain("High");
    expect(node.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe(
      "Subagent max effort",
    );
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
});

it("leads with an Automatic switch: bars dim to the inherited level, a bar or the switch leaves it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const change = vi.fn();
  const automaticChange = vi.fn();
  const options = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];
  const render = (value: string, inheritedValue?: string) =>
    act(async () =>
      root.render(
        createElement(EffortScale, {
          options,
          value,
          inheritedValue,
          automatic: { on: !value, onChange: automaticChange },
          label: "Effort",
          onValueChange: change,
        }),
      ),
    );
  const flags = (attr: string) =>
    [...node.querySelectorAll('[role="radio"]')].map((radio) => radio.hasAttribute(attr));
  const toggle = () => node.querySelector<HTMLButtonElement>('[role="switch"]')!;
  try {
    await render("", "medium");
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(toggle().textContent).toContain("Automatic");
    expect(node.querySelector("[data-automatic]")).not.toBeNull();
    expect(flags("data-filled")).toEqual([true, true, false]);
    expect(flags("data-inherited")).toEqual([true, true, false]);
    expect(node.querySelector('[role="radio"][aria-checked="true"]')).toBeNull();
    expect(node.textContent).toContain("Medium");
    // A bar while Automatic is on turns it off by choosing that level.
    await act(async () => node.querySelectorAll<HTMLButtonElement>('[role="radio"]')[2].click());
    expect(change).toHaveBeenLastCalledWith("high");
    // Switching Automatic off lands on the inherited level.
    await act(async () => toggle().click());
    expect(change).toHaveBeenLastCalledWith("medium");
    expect(automaticChange).not.toHaveBeenCalled();

    await render("high", "medium");
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(node.querySelector("[data-automatic]")).toBeNull();
    expect(flags("data-filled")).toEqual([true, true, true]);
    expect(flags("data-inherited")).toEqual([false, false, false]);
    expect(
      node.querySelector('[aria-checked="true"][role="radio"]')?.getAttribute("aria-label"),
    ).toBe("High");
    // Switching Automatic on hands clearing the level to the caller.
    await act(async () => toggle().click());
    expect(automaticChange).toHaveBeenLastCalledWith(true);

    // Without an inherited level, leaving Automatic starts in the middle of the scale.
    await render("");
    expect(node.textContent).not.toContain("·");
    expect(flags("data-filled")).toEqual([false, false, false]);
    await act(async () => toggle().click());
    expect(change).toHaveBeenLastCalledWith("medium");
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});

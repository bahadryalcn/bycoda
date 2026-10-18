// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeMode } from "../model/session";
import { AccessPicker } from "./AccessPicker";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function open(onChange: (mode: RuntimeMode) => void) {
  act(() =>
    root.render(
      createElement(AccessPicker, {
        value: "auto-accept-edits",
        onChange,
        unavailable: {
          supervised: "Headless agy cannot ask before editing files.",
        },
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>("[data-access-picker-trigger]")?.click());
}

const option = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("[role='option']")].find((el) =>
    el.textContent?.includes(label),
  );

describe("AccessPicker unavailable modes", () => {
  it("shows an unavailable mode with its reason and refuses to pick it", () => {
    const onChange = vi.fn();
    open(onChange);
    const supervised = option("Supervised");
    expect(supervised?.getAttribute("aria-disabled")).toBe("true");
    expect(supervised?.textContent).toContain(
      "Unavailable: Headless agy cannot ask before editing files.",
    );
    act(() => supervised?.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still lets the available modes be picked", () => {
    const onChange = vi.fn();
    open(onChange);
    expect(option("Auto-accept edits")?.getAttribute("aria-disabled")).toBeNull();
    act(() => option("Full access")?.click());
    expect(onChange).toHaveBeenCalledWith("full-access");
  });

  it("keeps the current selection distinct from keyboard navigation", () => {
    const onChange = vi.fn();
    open(onChange);
    const menu = document.querySelector<HTMLElement>("[data-access-picker]")!;
    act(() =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    expect(option("Auto-accept edits")?.getAttribute("aria-selected")).toBe("true");
    expect(menu.getAttribute("aria-activedescendant")).toBe(option("An AI reviewer")?.id);
    expect(option("An AI reviewer")?.getAttribute("data-button-selected")).toBe("true");
    expect(option("Auto-accept edits")?.hasAttribute("data-button-selected")).toBe(false);
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(menu.getAttribute("aria-activedescendant")).toBe(option("Auto-accept edits")?.id);
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onChange).toHaveBeenCalledWith("auto-accept-edits");
    expect(document.querySelector("[data-access-picker]")).toBeNull();
  });
});

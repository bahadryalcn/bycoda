// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FloatingButtonGroup } from "./FloatingButtonGroup";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("roves vertically across enabled commands and keeps one tab stop", () => {
  const onSelect = vi.fn();
  act(() =>
    root.render(
      createElement(FloatingButtonGroup, {
        label: "Selection actions",
        orientation: "vertical",
        items: [
          { id: "first", label: "First", onSelect },
          { id: "disabled", label: "Disabled", disabled: true, onSelect },
          { id: "pending", label: "Pending", loading: true, onSelect },
          { id: "last", label: "Last", onSelect },
        ],
      }),
    ),
  );
  const buttons = Array.from(container.querySelectorAll("button"));
  act(() => buttons[0]!.focus());
  const key = (value: string) =>
    act(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
      ),
    );
  key("ArrowDown");
  expect(document.activeElement).toBe(buttons[3]);
  key("ArrowDown");
  expect(document.activeElement).toBe(buttons[0]);
  key("End");
  expect(document.activeElement).toBe(buttons[3]);
  key("Home");
  expect(document.activeElement).toBe(buttons[0]);
  expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
  act(() => {
    buttons[1]!.click();
    buttons[2]!.click();
  });
  expect(onSelect).not.toHaveBeenCalled();
});

it("preserves pointer selections and exposes icon commands without hover", () => {
  const onSelect = vi.fn();
  act(() =>
    root.render(
      createElement(FloatingButtonGroup, {
        label: "Text commands",
        preserveSelection: true,
        items: [
          {
            id: "copy",
            label: "Copy selection",
            shortcut: "Ctrl+C",
            icon: createElement("span", null, "C"),
            iconOnly: true,
            onSelect,
          },
        ],
      }),
    ),
  );
  const button = container.querySelector("button")!;
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    button.dispatchEvent(down);
  });
  expect(down.defaultPrevented).toBe(true);
  expect(button.getAttribute("aria-label")).toBe("Copy selection");
  expect(button.title).toBe("Copy selection (Ctrl+C)");
  act(() => button.click());
  expect(onSelect).toHaveBeenCalledOnce();
  expect(container.querySelectorAll('[role="toolbar"]')).toHaveLength(1);
});
